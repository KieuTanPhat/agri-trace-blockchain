import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalize } from 'json-canonicalize';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const PG18 = 'postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const digest = data => createHash('sha256').update(data).digest('hex');
const run = (file, args, options = {}) => execFileSync(file, args, {
  cwd: repository, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 1200_000, ...options,
});
export function migrationChecksums() {
  const base = path.join(repository, 'apps/api/prisma/migrations');
  return Object.fromEntries(readdirSync(base).filter(name => existsSync(path.join(base, name, 'migration.sql')))
    .sort().map(name => [name, digest(readFileSync(path.join(base, name, 'migration.sql')))]));
}

/** The caller owns one heavy-job slot. No shared/native PostgreSQL is used. */
export async function withHybridStack(callback, { suite = 'hybrid-fabric' } = {}) {
  assert.equal(process.platform, 'linux', 'Run this isolated Docker harness on Linux; no hardcoded WSL/UNC adapter');
  const sha = run('git', ['rev-parse', 'HEAD']).trim();
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).trim();
  assert.equal(dirty, '', 'Freeze and commit source before collecting acceptance evidence');
  const suffix = randomBytes(5).toString('hex');
  const instance = `agri-hybrid-${suffix}`;
  const root = path.join(repository, 'blockchain/.fabric', instance);
  const evidenceDir = path.join(repository, 'artifacts', instance);
  const pg = `${instance}-pg18`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  const receipt = { sha, suite, startedAt: new Date().toISOString(), runtime: { node: process.version, platform: process.platform },
    instance, migrationChecksums: migrationChecksums(), governanceDigest: digest(canonicalize(JSON.parse(readFileSync(path.join(repository, 'blockchain/chaincode/src/governance.json'))))),
    suites: [], images: {}, passed: false, cleanup: { verified: false } };
  const env = { ...process.env, RELEASE_SHA: sha, AGRI_FABRIC_ROOT: root, FABRIC_ROOT: root,
    AGRI_FABRIC_INSTANCE: instance, AGRI_FABRIC_PORT_OFFSET: process.env.AGRI_FABRIC_PORT_OFFSET ?? '12000',
    AGRI_FABRIC_CPUS: '1', AGRI_FABRIC_MEMORY: '512m', CC_VERSION: `ci-${sha.slice(0, 12)}`, CC_SEQUENCE: '1',
    HYBRID_GOVERNANCE_DIGEST: receipt.governanceDigest, HYBRID_FABRIC_E2E: '1', NODE_ENV: 'test',
    JWT_SECRET: randomBytes(48).toString('hex'), IOT_INGEST_API_KEY: randomBytes(32).toString('hex'),
    HYBRID_SCRIPT: path.join(repository, 'blockchain/network/hybrid/hybrid-network.sh') };
  const execute = (file, args, options = {}) => run(file, args, { env, ...options });
  const network = (...args) => execute('bash', [env.HYBRID_SCRIPT, ...args]);
  const npm = (...args) => execute('npm', args, { stdio: 'inherit' });
  let networkStarted = false;
  let pgStarted = false;
  try {
    if (!process.env.HYBRID_FABRIC_BIN_DIR) {
      // Version and installer/sample commit pins are in network.sh. Bootstrap
      // only downloads tooling/images, never starts the legacy test network.
      execute('bash', ['blockchain/network/network.sh', 'bootstrap'], { stdio: 'inherit' });
    }
    const tools = process.env.HYBRID_FABRIC_BIN_DIR ?? path.join(repository, 'blockchain/.fabric/fabric-samples');
    cpSync(path.join(tools, 'bin'), path.join(root, 'fabric-samples/bin'), { recursive: true });
    cpSync(path.join(tools, 'config'), path.join(root, 'fabric-samples/config'), { recursive: true });
    env.PATH = `${path.join(root, 'fabric-samples/bin')}:${process.env.PATH}`;
    receipt.tooling = Object.fromEntries(['peer', 'configtxgen', 'osnadmin', 'fabric-ca-client', 'configtxlator']
      .map(name => [name, digest(readFileSync(path.join(root, 'fabric-samples/bin', name)))]));
    npm('run', 'build', '--workspace', 'blockchain/gateway');
    npm('run', 'build', '--workspace', 'blockchain/chaincode');
    npm('run', 'prisma:generate', '--workspace', 'apps/api');
    const password = randomBytes(24).toString('hex');
    execute('docker', ['run', '-d', '--name', pg, '--label', `agritrace.hybrid.instance=${instance}`,
      '--label', 'agritrace.purpose=hybrid-test', '--cpus', '1', '--memory', '384m', '--memory-swap', '384m',
      '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql:rw,size=512m',
      '-e', 'POSTGRES_USER=hybrid', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=hybrid', PG18]);
    pgStarted = true;
    const port = execute('docker', ['port', pg, '5432/tcp']).trim().split(':').at(-1);
    assert.match(port, /^[0-9]+$/);
    env.DATABASE_URL = env.TEST_DATABASE_URL = `postgresql://hybrid:${password}@127.0.0.1:${port}/hybrid?schema=public`;
    for (let i = 0; i < 60; i++) {
      try { execute('docker', ['exec', pg, 'pg_isready', '-U', 'hybrid', '-d', 'hybrid']); break; }
      catch { if (i === 59) throw new Error('Isolated PG18 did not become ready'); await delay(1000); }
    }
    npm('run', 'db:migrate', '--workspace', 'apps/api');
    networkStarted = true; // Covers partial up failures too.
    network('up');
    network('deploy');
    const resources = JSON.parse(execute('docker', ['inspect', ...execute('docker', ['ps', '-aq', '--filter', `label=agritrace.hybrid.instance=${instance}`]).trim().split(/\s+/)]));
    receipt.images = Object.fromEntries(resources.map(item => [item.Name.slice(1), { id: item.Image, configured: item.Config.Image }]));
    env.HYBRID_IMAGE_DIGESTS = JSON.stringify(receipt.images);
    await callback({ env, instance, root, pg, evidenceDir, receipt, execute, network, npm });
    receipt.passed = true;
  } catch (error) {
    // Public receipts contain classifications, never SQL dumps/config/key paths,
    // private arguments or assertion payloads. Detailed test output stays local.
    receipt.failure = { name: error?.name ?? 'Error', category: 'unclassified', stage: receipt.suites.at(-1)?.name ?? 'setup' };
    throw error;
  } finally {
    const cleanupErrors = [];
    if (networkStarted) try { network('down'); } catch { cleanupErrors.push('network-down'); }
    if (pgStarted) {
      try {
        const ownership = execute('docker', ['inspect', '--format', '{{index .Config.Labels "agritrace.hybrid.instance"}}', pg]).trim();
        assert.equal(ownership, instance);
        execute('docker', ['rm', '-f', pg]);
      } catch { cleanupErrors.push('pg18-remove'); }
    }
    for (const kind of ['container', 'network', 'volume']) {
      const args = kind === 'container' ? ['ps', '-aq'] : [kind, 'ls', '-q'];
      try { assert.equal(execute('docker', [...args, '--filter', `label=agritrace.hybrid.instance=${instance}`]).trim(), ''); }
      catch { cleanupErrors.push(`${kind}-remaining`); }
    }
    receipt.cleanup = { verified: cleanupErrors.length === 0, errors: cleanupErrors };
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(path.join(evidenceDir, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    // Crypto/MSP data is private and never uploaded. Keep failures for local
    // review unless cleanup verified and this exact owned path may be removed.
    if (receipt.cleanup.verified) {
      assert.equal(path.dirname(root), path.join(repository, 'blockchain/.fabric'));
      assert.equal(path.basename(root), instance);
      execute('docker', ['run', '--rm', '--network', 'none', '--label', `agritrace.hybrid.instance=${instance}`,
        '--cpus', '0.5', '--memory', '128m', '--memory-swap', '128m', '--user', '0',
        '-v', `${root}:/owned`, '--entrypoint', 'sh', PG18, '-c',
        'rm -rf /owned/net /owned/self /owned/cc-build /owned/cc-package']);
      rmSync(root, { recursive: true, force: true });
    }
    assert.ok(receipt.cleanup.verified, 'Isolated Hybrid cleanup is incomplete; receipt retained');
  }
}

async function main() {
  await withHybridStack(async ({ execute, env, receipt, npm, evidenceDir }) => {
    // The load/fault scenario is part of acceptance (10 clients, 200 Pending, two
    // bindings, outage and recovery); a skipped scenario fails the pending check below.
    env.HYBRID_LOAD_E2E = '1';
    env.RATE_LIMIT_REQUESTS = '100000';
    env.HYBRID_LOAD_REPORT = path.join(evidenceDir, 'load.json');
    receipt.suites.push({ name: 'ledger-acceptance', status: 'running' });
    execute(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'blockchain/network/hybrid/acceptance/ledger-acceptance.mts'], { stdio: 'inherit' });
    receipt.suites.at(-1).status = 'passed';
    receipt.suites.push({ name: 'api-worker-fabric', status: 'running' });
    npm('run', 'test:e2e', '--workspace', 'apps/api', '--', 'test/hybrid-fabric.e2e-spec.ts', '--reporter=default', '--reporter=json',
      '--outputFile=../../artifacts/hybrid-fabric-vitest.json');
    const result = JSON.parse(readFileSync(path.join(repository, 'artifacts/hybrid-fabric-vitest.json')));
    assert.ok(result.numPassedTests > 0);
    assert.equal(result.numPendingTests, 0, 'Skipped real Fabric tests cannot establish release acceptance');
    assert.equal(result.numFailedTests, 0);
    receipt.suites.at(-1).status = 'passed';
    receipt.suites.at(-1).passed = result.numPassedTests;
    receipt.suites.at(-1).skipped = result.numPendingTests;
    // Measured under the isolated quotas; the scenario itself asserts p95 <= 2s and drain <= 15min.
    receipt.suites.at(-1).load = JSON.parse(readFileSync(env.HYBRID_LOAD_REPORT, 'utf8'));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Hybrid Fabric acceptance failed; inspect local evidence'); process.exitCode = 1; });
