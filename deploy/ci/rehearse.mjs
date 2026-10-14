// Production rehearsal on a disposable GitHub runner. It runs the images built from this commit under the
// production application model (docker-compose.app.yml) with an isolated PostgreSQL 18 and the real edge
// routing, then proves migration, provisioning, business flows, event validity and backup/restore.
// It never reads a VPS secret, database, identity or volume, and refuses to run anywhere else.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSmoke } from './smoke.mjs';
import { CADDY_IMAGE, COUNT_SQL, EVENT_SQL, POSTGRES_IMAGE, composeModelErrors, migrationChecksums, migrationErrors, ownedResources, proxyCaddyfile, rehearsalIdentity } from './lib.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://127.0.0.1:18080';
const identity = rehearsalIdentity(process.env);
const { project, ingress, volume, imageTag } = identity;
const POSTGRES_USER = 'agritrace';
const POSTGRES_DB = 'agri_trace_prod';
const evidence = { sha: process.env.GITHUB_SHA ?? null, project, startedAt: new Date().toISOString(), steps: [], result: 'failed' };

function run(file, args, { input, timeout = 300_000, encoding = 'utf8', quiet = false } = {}) {
  try {
    return execFileSync(file, args, { cwd: repository, input, timeout, encoding, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    // Compose arguments, environment and output may carry rehearsal secrets: name the step, not the payload.
    if (!quiet && error.stderr) process.stderr.write(String(error.stderr).split('\n').slice(-40).join('\n') + '\n');
    throw new Error(`${path.basename(file)} ${args.find(arg => !arg.startsWith('-')) ?? ''} failed`);
  }
}

const checkpoint = step => { evidence.steps.push(step); console.log(`✔ ${step}`); };
let environmentFile;
let rehearsalDir;
const compose = (...args) => ['compose', '--project-name', project, '--project-directory', repository, '--env-file', environmentFile,
  '-f', 'docker-compose.app.yml', '-f', 'deploy/ci/docker-compose.rehearsal.yml', ...args];
const dc = (args, options) => run('docker', compose(...args), options);
const psql = query => dc(['exec', '-T', 'postgres', 'psql', '-U', POSTGRES_USER, '-d', POSTGRES_DB, '-v', 'ON_ERROR_STOP=1', '-At', '-c', query]).trim();
const inApi = (script, options) => dc(['run', '--rm', '--no-deps', '-T', 'api', 'node', script], options);
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const fingerprint = () => ({ counts: JSON.parse(psql(COUNT_SQL)), traceHash: psql(EVENT_SQL) });

function validateCaddy(file) {
  run('docker', ['run', '--rm', '--network', 'none', '-v', `${file}:/etc/caddy/Caddyfile:ro`, CADDY_IMAGE,
    'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], { timeout: 120_000 });
}

function checkEvents(minimum) {
  const output = dc(['run', '--rm', '--no-deps', '-T', '-e', 'CI_VALIDATOR_PATH=/validator/validation.js',
    '-v', `${path.join(repository, 'blockchain/chaincode/dist')}:/validator:ro`, '--entrypoint', 'node', 'api', 'deploy/ci/check-events.mjs']);
  const result = JSON.parse(output.trim().split('\n').at(-1));
  assert.equal(result.result, 'passed');
  assert.ok(result.checked >= minimum, 'The event check must inspect the events the smoke created');
  assert.equal(result.writes, 0);
  return result.checked;
}

function fixtureFor() {
  const organizations = Object.fromEntries(['FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR'].map(role => [role, randomUUID()]));
  const accounts = ['SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR'].map(role => ({
    id: randomUUID(), role, email: `${role.toLowerCase()}@rehearsal.example.test`, password: randomBytes(24).toString('base64url'),
    ...(role === 'SYSTEM_ADMIN' ? {} : { organizationId: organizations[role] }),
  }));
  return { accounts, organizations, chainId: randomUUID(), farmId: randomUUID(), plotId: randomUUID(), productId: randomUUID() };
}

async function main() {
  assert.equal(process.platform, 'linux', 'The rehearsal needs a Linux Docker runner');
  assert.ok(existsSync(path.join(repository, 'blockchain/chaincode/dist/validation.js')), 'Build blockchain/chaincode before the rehearsal');
  rehearsalDir = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'agritrace-rehearsal-'));
  environmentFile = path.join(rehearsalDir, 'rehearsal.env');

  // Never adopt or reset anything that already exists.
  assert.deepEqual(ownedResources(run, project), [], 'Rehearsal resources already exist');
  assert.throws(() => run('docker', ['network', 'inspect', ingress], { quiet: true }), /failed/, 'Ingress network already exists');

  const production = readFileSync(path.join(repository, 'deploy/edge/Caddyfile'), 'utf8');
  const derived = path.join(rehearsalDir, 'Caddyfile');
  writeFileSync(derived, proxyCaddyfile(production), { mode: 0o644 });
  validateCaddy(derived);
  const productionCopy = path.join(rehearsalDir, 'Caddyfile.production');
  writeFileSync(productionCopy, production, { mode: 0o644 });
  validateCaddy(productionCopy);
  checkpoint('Production edge Caddyfile validates and its routing snippet drives the rehearsal proxy');

  const apiImage = `${imageTag}-api:local`;
  const webImage = `${imageTag}-web:local`;
  const password = randomBytes(24).toString('base64url');
  writeFileSync(environmentFile, Object.entries({
    API_IMAGE: apiImage, WEB_IMAGE: webImage, POSTGRES_IMAGE, CADDY_IMAGE, REHEARSAL_DIR: rehearsalDir,
    POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD: password, POSTGRES_VOLUME: volume, INGRESS_NETWORK: ingress,
    JWT_SECRET: randomBytes(48).toString('hex'), IOT_INGEST_API_KEY: randomBytes(32).toString('hex'),
    PUBLIC_ORIGIN: origin, CORS_ORIGINS: origin, UPSTREAM_PREFIX: 'prod', DEPLOY_ENV: 'ci',
  }).map(([key, value]) => `${key}=${value}\n`).join(''), { mode: 0o600 });
  run('docker', ['network', 'create', '--label', `agritrace.ci-rehearsal=${project}`, ingress]);

  const labels = ['--label', `org.opencontainers.image.revision=${process.env.GITHUB_SHA ?? 'unknown'}`, '--label', `agritrace.ci-rehearsal=${project}`];
  run('docker', ['build', ...labels, '-t', apiImage, '-f', 'apps/api/Dockerfile', '.'], { timeout: 1_200_000 });
  run('docker', ['build', ...labels, '-t', webImage, '-f', 'apps/web/Dockerfile',
    '--build-arg', `NEXT_PUBLIC_API_BASE_URL=${origin}/api`, '--build-arg', 'NEXT_PUBLIC_API_SAME_ORIGIN=true',
    '--build-arg', `NEXT_PUBLIC_TRACE_BASE_URL=${origin}/trace`, '--build-arg', 'NEXT_PUBLIC_MOCK_API=false', '.'], { timeout: 1_200_000 });
  checkpoint('Production API and Web images build from this commit');

  const model = JSON.parse(dc(['--profile', 'tools', 'config', '--format', 'json'], { quiet: true }));
  assert.deepEqual(composeModelErrors(model, { project, services: ['postgres', 'migrate', 'api', 'web', 'proxy'] }), []);
  checkpoint('Compose model keeps quotas, loopback-only publishing and the reviewed service set');

  dc(['up', '-d', '--wait', '--wait-timeout', '120', 'postgres']);
  assert.equal(Number.parseInt(psql('SHOW server_version'), 10), 18, 'The rehearsal database must be PostgreSQL 18');
  dc(['--profile', 'tools', 'run', '--rm', 'migrate']);
  dc(['--profile', 'tools', 'run', '--rm', 'migrate']);
  const applied = JSON.parse(psql(`SELECT coalesce(json_agg(json_build_object('migration_name', migration_name, 'checksum', checksum, 'finished_at', finished_at, 'rolled_back_at', rolled_back_at)), '[]'::json) FROM _prisma_migrations`));
  const expected = migrationChecksums(repository);
  assert.deepEqual(migrationErrors(applied, expected), []);
  evidence.migrations = Object.keys(expected).length;
  checkpoint(`${evidence.migrations} migrations apply from empty, replay as a no-op and match repository checksums`);

  const provisionRole = () => dc(['run', '--rm', '--no-deps', '-T', 'api', 'npm', 'run', 'db:provision-compliance-role', '--workspace', 'apps/api']);
  assert.match(provisionRole(), /^COMPLIANCE_REVIEWER provisioned; created=1$/m);
  assert.match(provisionRole(), /^COMPLIANCE_REVIEWER provisioned; created=0$/m);
  checkpoint('COMPLIANCE_REVIEWER provisioning creates once and replays without duplicates on the runtime image');

  const fixture = fixtureFor();
  const provisioning = { accounts: fixture.accounts, catalog: { chainId: fixture.chainId, farmId: fixture.farmId, plotId: fixture.plotId, productId: fixture.productId } };
  const provision = () => JSON.parse(inApi('deploy/ci/provision.mjs', { input: JSON.stringify(provisioning) }).trim().split('\n').at(-1));
  assert.deepEqual(provision(), { result: 'passed', usersCreated: 5 });
  assert.deepEqual(provision(), { result: 'passed', usersCreated: 0 });
  checkpoint('Production provisioning creates five accounts and replays idempotently');

  dc(['up', '-d', '--wait', '--wait-timeout', '240', 'api', 'web', 'proxy']);
  const smoke = await runSmoke({ origin, fixture });
  evidence.smoke = { flows: smoke.flows, lots: smoke.lotIds.length };
  checkpoint(`Business and session flows pass through the production edge routing (${smoke.flows.length} flows)`);
  const checked = checkEvents(5);
  checkpoint(`${checked} trace events are accepted by the compiled chaincode input validator`);

  // Backup and restore into a brand-new volume; the database is never overwritten in place.
  dc(['stop', 'api', 'web', 'proxy']);
  const before = fingerprint();
  assert.ok(before.counts.trace_event >= 5 && before.counts.lot >= 2);
  const dump = dc(['exec', '-T', 'postgres', 'pg_dump', '--format=custom', '--no-owner', '--no-acl', '-U', POSTGRES_USER, '-d', POSTGRES_DB], { encoding: 'buffer' });
  assert.ok(dump.length > 0);
  const dumpFile = path.join(rehearsalDir, 'rehearsal.dump');
  writeFileSync(dumpFile, dump, { mode: 0o600 });
  const dumpDigest = sha256(dump);
  assert.deepEqual(fingerprint(), before, 'Data changed during backup');
  dc(['down', '--volumes', '--remove-orphans']);
  assert.deepEqual(ownedResources(run, project), [], 'The rehearsal database volume must be gone before restore');
  dc(['up', '-d', '--wait', '--wait-timeout', '120', 'postgres']);
  assert.equal(Number(psql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')")), 0, 'Restore target must be empty');
  assert.equal(sha256(readFileSync(dumpFile)), dumpDigest, 'Dump checksum mismatch');
  dc(['exec', '-T', 'postgres', 'pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '-U', POSTGRES_USER, '-d', POSTGRES_DB],
    { input: readFileSync(dumpFile) });
  assert.deepEqual(fingerprint(), before, 'Restored counts or trace hashes differ');
  dc(['--profile', 'tools', 'run', '--rm', 'migrate']);
  assert.deepEqual(migrationErrors(JSON.parse(psql(`SELECT coalesce(json_agg(json_build_object('migration_name', migration_name, 'checksum', checksum, 'finished_at', finished_at, 'rolled_back_at', rolled_back_at)), '[]'::json) FROM _prisma_migrations`)), expected), []);
  checkpoint('Backup restores into an empty database with identical counts and trace hashes, and migrations stay a no-op');

  dc(['up', '-d', '--wait', '--wait-timeout', '240', 'api', 'web', 'proxy']);
  const restored = await runSmoke({ origin, fixture, full: false, expectedLots: smoke.lotIds, expectedTraceTokens: smoke.traceTokens });
  assert.equal(restored.restoredLots, smoke.lotIds.length);
  assert.equal(checkEvents(before.counts.trace_event), before.counts.trace_event);
  evidence.restore = { counts: before.counts, traceHash: before.traceHash, dumpSha256: dumpDigest };
  checkpoint('Restored stack serves the same accounts, lots, public QR data and valid events');
  evidence.result = 'passed';
}

async function cleanup() {
  const errors = [];
  const attempt = (name, action) => { try { action(); } catch { errors.push(name); } };
  if (environmentFile && existsSync(environmentFile)) {
    if (evidence.result !== 'passed') attempt('diagnostics', () => {
      console.error(dc(['ps', '--all'], { quiet: true }));
      console.error(dc(['logs', '--no-color', '--tail', '80', 'api', 'web', 'proxy'], { quiet: true }));
    });
    attempt('compose-down', () => dc(['down', '--volumes', '--remove-orphans'], { quiet: true }));
  }
  attempt('ingress-remove', () => {
    const label = run('docker', ['network', 'inspect', '--format', '{{index .Labels "agritrace.ci-rehearsal"}}', ingress], { quiet: true }).trim();
    assert.equal(label, project);
    run('docker', ['network', 'rm', ingress], { quiet: true });
  });
  for (const tag of [`${imageTag}-api:local`, `${imageTag}-web:local`]) attempt('image-remove', () => run('docker', ['image', 'rm', '--force', tag], { quiet: true }));
  attempt('residue', () => assert.deepEqual(ownedResources(run, project), []));
  if (rehearsalDir) attempt('workdir', () => {
    assert.ok(path.basename(rehearsalDir).startsWith('agritrace-rehearsal-'));
    rmSync(rehearsalDir, { recursive: true, force: true });
  });
  evidence.cleanup = { verified: errors.length === 0, errors };
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(path.join(repository, 'artifacts'), { recursive: true });
  writeFileSync(path.join(repository, 'artifacts/production-rehearsal.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (errors.length) { console.error(`Rehearsal cleanup incomplete: ${errors.join(', ')}`); process.exitCode = 1; }
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Production rehearsal failed'); process.exitCode = 1; }
finally { await cleanup(); }
