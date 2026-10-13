import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  appendFileSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, statSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const image = 'postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';

// Check individual assertions as well as reporter totals: an aggregate green
// summary must never turn skipped, pending or missing DB coverage into a pass.
export function validateVitestReport(report, expected) {
  assert.equal(report.success, true);
  assert.equal(report.numTotalTests, expected.tests);
  assert.equal(report.numPassedTests, expected.tests);
  for (const field of ['numFailedTests', 'numPendingTests', 'numTodoTests', 'numFailedTestSuites', 'numPendingTestSuites']) {
    assert.equal(report[field], 0, `${field} must be zero`);
  }
  assert.equal(report.testResults.length, expected.files);
  const assertions = report.testResults.flatMap(file => {
    assert.equal(file.status, 'passed');
    assert(Array.isArray(file.assertionResults) && file.assertionResults.length > 0);
    return file.assertionResults;
  });
  assert.equal(assertions.length, expected.tests);
  for (const assertion of assertions) {
    assert.equal(assertion.status, 'passed');
    assert(Array.isArray(assertion.ancestorTitles));
    assert.equal(assertion.failureMessages?.length ?? 0, 0);
  }
  const httpGroups = assertions.filter(assertion => assertion.ancestorTitles.some(title => /\bHTTP\b/.test(title))).length;
  if (expected.httpGroups !== undefined) assert.equal(httpGroups, expected.httpGroups);
  return { tests: assertions.length, files: report.testResults.length, httpGroups, skipped: 0, todo: 0, failed: 0 };
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
}
function sourceSha() {
  const source = git('rev-parse', 'HEAD').toString('utf8').trim();
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.equal(process.env.HYBRID_CI_SHA, source);
  return source;
}
function isolatedPath(value, mustExist = true) {
  assert(value && isAbsolute(value), 'Absolute isolated evidence path required');
  const destination = resolve(value);
  const evidence = join(root, '.codex', 'evidence');
  const suffix = relative(evidence, destination);
  assert(suffix && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix));
  const ancestors = relative(root, destination).split(sep);
  let current = root;
  for (const component of ancestors) {
    current = join(current, component);
    try { assert(!lstatSync(current).isSymbolicLink(), 'Symlink evidence path refused'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (mustExist) assert(statSync(destination).isDirectory());
  return destination;
}
function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
function unchanged(source) {
  assert.equal(git('rev-parse', 'HEAD').toString('utf8').trim(), source);
  git('ls-files', '--error-unmatch', 'scripts/ci/hybrid-policy-run.mjs', 'scripts/ci/hybrid-db-prepare.mjs', 'scripts/ci/hybrid-orm-check.mjs');
  git('diff', '--exit-code', '--no-ext-diff', source, '--', 'apps/api', 'apps/web', 'blockchain/gateway',
    'docs/sql', 'scripts/ci', 'package.json', 'package-lock.json', '.github/workflows/application-ci.yml');
  assert.equal(git('ls-files', '--others', '--exclude-standard', '--', 'apps/api', 'apps/web', 'blockchain/gateway',
    'docs/sql', 'scripts/ci', 'package.json', 'package-lock.json', '.github/workflows/application-ci.yml').toString('utf8').trim(), '');
}
async function run(control, label, command, args, options = {}) {
  const file = join(control, label + '.private.log');
  const fd = openSync(file, 'wx', 0o600);
  const child = spawn(command, args, {
    cwd: options.cwd ?? root, env: options.env ?? process.env,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', fd, fd],
    detached: process.platform !== 'win32', windowsHide: true,
  });
  try {
    const exited = new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveExit({ code, signal }));
    });
    if (options.input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(options.input);
    }
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), options.timeout ?? 300000);
    });
    let result;
    try { result = await Promise.race([exited, deadline]); }
    finally { clearTimeout(timer); }
    assert.equal(result.code, 0, `${label} failed; restricted diagnostics retained`);
    assert(statSync(file).size <= 32 * 1024 * 1024, 'Diagnostic output exceeded limit');
    return readFileSync(file, 'utf8');
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' }); }
        catch { /* It may have exited during cleanup. */ }
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
        await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
        if (child.exitCode === null && child.signalCode === null) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
        }
      }
    }
    closeSync(fd);
  }
}
function lastJson(output) {
  return JSON.parse(output.trim().split(/\r?\n/).at(-1));
}
function migrationChecksums(source) {
  const paths = git('ls-tree', '-r', '--name-only', source, '--', 'apps/api/prisma/migrations').toString('utf8')
    .trim().split('\n').filter(file => file.endsWith('/migration.sql'));
  assert.equal(paths.length, 17, 'Review the acceptance catalog before changing its migration floor');
  return Object.fromEntries(paths.map(file => [file.split('/').at(-2), createHash('sha256').update(git('show', `${source}:${file}`)).digest('hex')]));
}

async function policy() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.HYBRID_CI_TESTS, '1');
  assert.equal(process.env.HYBRID_DRAFT_TESTS, '1');
  assert.equal(process.env.FABRIC_ENABLED, 'false');
  assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '25488');
  assert.equal(url.pathname, '/scope_test');
  assert.equal(url.username, 'scope_test');
  assert.equal(url.search + url.hash, '');
  const source = sourceSha();
  unchanged(source);
  const control = isolatedPath(process.env.HYBRID_CI_CONTROL, false);
  mkdirSync(control, { recursive: false, mode: 0o700 });
  let stage = 'preparation-receipt';
  const record = data => appendFileSync(join(control, 'acceptance.log'), JSON.stringify({ stage, ...data }) + '\n', { mode: 0o600 });
  try {
    const preparationFile = process.env.HYBRID_CI_PREPARATION;
    isolatedPath(dirname(preparationFile));
    assert(!lstatSync(preparationFile).isSymbolicLink() && statSync(preparationFile).size < 1024 * 1024);
    const preparation = JSON.parse(readFileSync(preparationFile, 'utf8'));
    assert.equal(preparation.protocol, 'agritrace-hybrid-preparation/1');
    assert.equal(preparation.status, 'passed');
    assert.equal(preparation.mode, 'legacy');
    assert.equal(preparation.sourceSha, source);
    assert.equal(preparation.synthetic, true);
    assert.equal(preparation.fabricAcceptance, false);
    assert.equal(preparation.sourceUnchanged, true);
    assert.equal(preparation.stageCatalogRemoved, true);
    assert.equal(preparation.appliedMigrationCount, 17);
    assert.equal(preparation.fixture.events, 28);
    assert.equal(preparation.fixture.scenarios, 14);
    assert.equal(preparation.fixture.guardsDisabled, false);
    assert.equal(preparation.fixture.synthetic, true);
    const checksums = migrationChecksums(source);
    assert.deepEqual(preparation.migrationChecksums, checksums);
    const pgEnv = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1), PGCONNECT_TIMEOUT: '10', PGSERVICE: '', PGSERVICEFILE: '' };
    const sql = input => run(control, stage, 'psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--set=ON_ERROR_STOP=1'], { input, env: pgEnv });
    stage = 'postgres-major';
    assert.equal(Math.floor(Number((await sql('SHOW server_version_num;')).trim()) / 10000), 18);
    stage = 'schema-alignment';
    const alignment = lastJson(await run(control, stage, process.execPath, [join(root, 'apps/api/scripts/check-schema-alignment.mjs')], { cwd: join(root, 'apps/api') }));
    assert.deepEqual(alignment, { schemaAligned: true, uniqueGuards: 6, sqlExecuted: false });
    writeJson(join(control, 'schema-alignment.json'), alignment);
    record({ status: 'passed', ...alignment });
    stage = 'sql-scenarios';
    const scenarios = lastJson(await sql(git('show', `${source}:docs/sql/hybrid-business-scope.test.sql`)));
    assert.equal(scenarios.assertions, 31);
    assert.equal(scenarios.cases.length, 31);
    assert.equal(new Set(scenarios.cases).size, 31);
    assert(scenarios.cases.every(name => typeof name === 'string' && name.length > 0));
    writeJson(join(control, 'sql-result.json'), scenarios);
    record({ status: 'passed', assertions: scenarios.assertions });
    stage = 'orm';
    const orm = lastJson(await run(control, stage, process.execPath, ['--import', 'tsx', join(root, 'scripts/ci/hybrid-orm-check.mjs')]));
    assert.equal(orm.result, 'orm-schema-alignment-passed');
    assert.equal(orm.sourceSha, source);
    assert.equal(orm.synthetic, true);
    assert.equal(orm.fabricAcceptance, false);
    assert.equal(orm.originalAssignments, 3);
    assert.equal(orm.originalRevisions, 3);
    assert.equal(orm.originalConsents, 9);
    assert.equal(orm.organizationCutovers, 4);
    assert.equal(orm.deferredRevisionCreate, 'passed');
    assert.equal(orm.consentRelations, 'passed');
    assert.equal(orm.applicationWorkflowAcceptance, 'not-evaluated');
    writeJson(join(control, 'orm-result.json'), orm);
    record({ status: 'passed' });
    const suites = {};
    for (const [name, config, expected] of [
      ['policy', 'vitest.config.hybrid.ts', { tests: 132, files: 5, httpGroups: 26 }],
      ['legacy', 'vitest.config.e2e.ts', { tests: 112, files: 7 }],
    ]) {
      stage = name;
      const reportFile = join(control, `${name}.private.json`);
      await run(control, stage, process.execPath, [join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), 'run', '--config', config,
        '--no-file-parallelism', '--testTimeout=30000', '--reporter=json', '--outputFile', reportFile], { cwd: join(root, 'apps/api'), timeout: 1200000 });
      assert(statSync(reportFile).size < 16 * 1024 * 1024);
      suites[name] = validateVitestReport(JSON.parse(readFileSync(reportFile, 'utf8')), expected);
      writeJson(join(control, `${name}-result.json`), suites[name]);
      record({ status: 'passed', ...suites[name] });
    }
    unchanged(source);
    stage = 'complete';
    const receipt = { protocol: 'agritrace-hybrid-policy/1', status: 'passed', sourceSha: source,
      postgresMajor: 18, migrationChecksums: checksums, appliedMigrationCount: 17,
      sqlScenarios: scenarios.assertions, schemaAligned: true, uniqueGuards: 6, orm,
      suites, synthetic: true, fabricAcceptance: false, sharedDatabaseTouched: false,
      productionResourcesUsed: false, sourceUnchanged: true };
    writeJson(join(control, 'policy-run.json'), receipt);
    record({ status: 'passed', sourceSha: source });
    console.log(JSON.stringify(receipt));
  } catch {
    writeJson(join(control, 'policy-failure.json'), { protocol: 'agritrace-hybrid-policy/1', status: 'failed', sourceSha: source, stage, synthetic: true, fabricAcceptance: false });
    record({ status: 'failed', sourceSha: source });
    throw new Error(`Hybrid ${stage} acceptance failed; restricted diagnostics retained`);
  }
}

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 });
}
function ciServices() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Service lifecycle commands require an ephemeral GitHub runner');
  assert.equal(realpathSync(root), realpathSync(process.env.GITHUB_WORKSPACE));
  const scope = `hybrid-ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  assert.match(scope, /^hybrid-ci-\d+-\d+$/);
  assert.equal(process.env.HYBRID_CI_SCOPE, scope);
  const control = isolatedPath(process.env.HYBRID_CI_EVIDENCE);
  const services = [
    { role: 'policy', id: process.env.HYBRID_POLICY_CONTAINER, port: '25488' },
    { role: 'browser', id: process.env.HYBRID_BROWSER_CONTAINER, port: '25489' },
  ];
  for (const service of services) assert.match(service.id ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(services[0].id, services[1].id);
  return { source: sourceSha(), scope, control, services };
}
function inspectOwned(service, scope) {
  const [metadata] = JSON.parse(docker('inspect', service.id));
  assert.equal(metadata.Id, service.id);
  assert.equal(metadata.Config.Labels['agritrace.scope'], `${scope}-${service.role}`);
  return metadata;
}
function serviceEvidence() {
  const { source, scope, control, services } = ciServices();
  const records = services.map(service => {
    const metadata = inspectOwned(service, scope);
    assert.equal(metadata.Config.Image, image);
    assert.equal(metadata.HostConfig.Memory, 384 * 1024 ** 2);
    assert.equal(metadata.HostConfig.NanoCpus, 10 ** 9);
    assert.equal(metadata.HostConfig.Tmpfs['/var/lib/postgresql'], 'rw,size=256m');
    assert.deepEqual(metadata.HostConfig.PortBindings['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: service.port }]);
    assert.equal(metadata.State.Running, true);
    assert.equal(metadata.State.Health.Status, 'healthy');
    assert.equal(metadata.State.OOMKilled, false);
    assert.equal(metadata.RestartCount, 0);
    const networks = Object.entries(metadata.NetworkSettings.Networks).map(([name, value]) => ({ name, id: value.NetworkID }));
    assert(networks.length > 0);
    return { ...service, image, memoryBytes: metadata.HostConfig.Memory, cpuCount: 1, loopbackOnly: true, tmpfsBytes: 256 * 1024 ** 2, networks };
  });
  writeJson(join(control, 'services.json'), { sourceSha: source, scope, services: records, productionResourcesUsed: false });
}
async function released(port) {
  return new Promise(resolvePort => {
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) });
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolvePort(false); });
    socket.once('error', () => { socket.destroy(); resolvePort(true); });
    socket.once('timeout', () => { socket.destroy(); resolvePort(false); });
  });
}
async function cleanupServices() {
  const { source, scope, control, services } = ciServices();
  // Check BOTH identities before removing either service. No Compose project,
  // unrelated container, local daemon network or shared database is targeted.
  const metadata = services.map(service => inspectOwned(service, scope));
  for (const service of services) {
    docker('stop', '--time', '15', service.id);
    docker('rm', service.id);
  }
  const removed = services.every(service => {
    try { docker('inspect', service.id); return false; } catch { return true; }
  });
  const portsReleased = (await Promise.all(services.map(service => released(service.port)))).every(Boolean);
  const receipt = { sourceSha: source, scope, servicesRemoved: removed, portsReleased,
    databaseStates: metadata.map((item, index) => ({ role: services[index].role, oomKilled: item.State.OOMKilled, restarts: item.RestartCount })),
    networkLifecycle: 'github-service-network-cleaned-by-runner-after-job', productionResourcesUsed: false };
  writeJson(join(control, 'services-cleanup.json'), receipt);
  assert(removed && portsReleased, 'Isolated CI services cleanup incomplete');
}

async function main() {
  const mode = process.argv[2] ?? 'policy';
  if (mode === 'policy') return policy();
  if (mode === 'services') return serviceEvidence();
  if (mode === 'cleanup') return cleanupServices();
  throw new Error('Unknown Hybrid acceptance mode');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch {
    console.error('Isolated Hybrid acceptance failed; review guarded inputs and restricted diagnostics.');
    process.exitCode = 1;
  }
}
