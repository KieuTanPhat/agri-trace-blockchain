import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { canonicalize } from 'json-canonicalize';
import { composeArgs, loadConfig } from './config.mjs';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const projects = { standard: 'agri-trace-ci', uat: 'agri-trace-uat-ci', fabric: 'agri-trace-fabric-ci' };

// Public metadata for the disposable technical test network. This does not
// attest enterprise CA/admin/peer authority, and is never a production default.
export function technicalFixtureRoute() {
  const payload = {
    protocol: 'agritrace-ledger-route/1', mode: 'WRITE', network: 'hyperledger-fabric',
    channelId: 'agritrace', chaincodeName: 'agritrace', contractName: 'AgriTraceContract',
    envelopeVersion: '3.0.0', writerAuthority: 'isolated:technical-relayer',
    writerMspId: 'Org1MSP', writerRole: 'relayer',
  };
  return { ...payload, digest: createHash('sha256').update(canonicalize(payload)).digest('hex') };
}

export function fixtureGuards(environment, source, stack) {
  assert.equal(environment.GITHUB_ACTIONS, 'true');
  assert.equal(environment.HYBRID_CONTAINER_TESTS, '1');
  assert.match(environment.GITHUB_RUN_ID ?? '', /^\d+$/);
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.equal(environment.GITHUB_SHA, source);
  assert(Object.hasOwn(projects, stack));
  assert.equal(environment.COMPOSE_PROJECT_NAME, projects[stack]);
  assert(!environment.DOCKER_HOST && !environment.DOCKER_TLS_VERIFY);
  const origin = new URL(environment.CI_API_URL ?? 'http://127.0.0.1:8080/api');
  assert.equal(origin.protocol, 'http:');
  assert(['127.0.0.1', 'localhost'].includes(origin.hostname));
  assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
  return projects[stack];
}

function inside(child, parent) {
  const suffix = relative(parent, child);
  return suffix && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix);
}
function privateDirectory(value, create) {
  assert(value);
  const directory = resolve(root, value);
  assert(inside(directory, join(root, '.codex', 'evidence')) || inside(directory, join(root, '.uat')));
  let current = root;
  for (const component of relative(root, directory).split(sep)) {
    current = join(current, component);
    if (existsSync(current)) assert(!lstatSync(current).isSymbolicLink());
  }
  if (create) {
    mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
    mkdirSync(directory, { recursive: false, mode: 0o700 });
  }
  assert(statSync(directory).isDirectory());
  return realpathSync(directory);
}
function jsonFile(file) {
  const metadata = lstatSync(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size < 1024 * 1024);
  return JSON.parse(readFileSync(file, 'utf8'));
}
function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function metadata(route, source) {
  return {
    APP_RELEASE_SHA: source,
    LEDGER_ROUTE_PINS: JSON.stringify([route.digest]),
    LEDGER_ACTIVE_ROUTE_DIGEST: route.digest,
    LEDGER_ROUTE_IMPORT_PINS: '[]', LEDGER_PAUSED_WRITER_PINS: '[]',
    LEDGER_WRITER_AUTHORITY: route.writerAuthority,
  };
}
function uatFile(value) {
  assert(value);
  const file = resolve(root, value);
  assert.equal(file, join(root, '.uat', 'ci', '.env.uat'));
  const info = lstatSync(file);
  assert(info.isFile() && !info.isSymbolicLink() && info.size < 65536);
  if (process.platform !== 'win32') assert.equal(info.mode & 0o077, 0);
  const config = loadConfig(file);
  assert.equal(config.PUBLIC_ORIGIN, 'http://127.0.0.1:18080');
  return { file, config };
}
function prepare(options, context) {
  const directory = privateDirectory(options.directory, true);
  const route = technicalFixtureRoute();
  const pins = metadata(route, context.source);
  let env;
  if (context.stack === 'uat') {
    env = uatFile(options.env).file;
    const text = readFileSync(env, 'utf8');
    for (const key of Object.keys(pins)) assert(!new RegExp(`^${key}=`, 'm').test(text));
  } else assert(!options.env);
  writeJson(join(directory, 'route.json'), route);
  writeJson(join(directory, 'preparation.json'), {
    protocol: 'agritrace-ci-route-fixture/1', sourceSha: context.source,
    project: context.project, stack: context.stack, digest: route.digest,
    synthetic: true, fabricAcceptance: false, databaseAccessed: false,
  });
  if (env) appendFileSync(env, Object.entries(pins).map(([key, value]) => `${key}='${value}'\n`).join(''));
  assert(process.env.GITHUB_ENV && isAbsolute(process.env.GITHUB_ENV));
  appendFileSync(process.env.GITHUB_ENV, Object.entries(pins).map(([key, value]) => `${key}=${value}\n`).join(''));
  console.log(JSON.stringify({ result: 'prepared', sourceSha: context.source, digest: route.digest, synthetic: true, fabricAcceptance: false }));
}
function docker(args) {
  return execFileSync('docker', args, { cwd: root, env: process.env, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, maxBuffer: 4 * 1024 * 1024 }).trim();
}
function register(options, context) {
  const directory = privateDirectory(options.directory, false);
  const expected = technicalFixtureRoute();
  const route = jsonFile(join(directory, 'route.json'));
  assert.deepEqual(route, expected);
  const preparation = jsonFile(join(directory, 'preparation.json'));
  assert.equal(preparation.sourceSha, context.source);
  assert.equal(preparation.project, context.project);
  assert.equal(preparation.stack, context.stack);
  assert.equal(preparation.digest, route.digest);
  assert.equal(preparation.synthetic, true);
  assert.equal(preparation.fabricAcceptance, false);
  const [daemon] = JSON.parse(docker(['context', 'inspect']));
  assert.equal(daemon.Endpoints.docker.Host, 'unix:///var/run/docker.sock');
  const args = context.stack === 'uat'
    ? composeArgs(uatFile(options.env).file)
    : ['compose', '-f', 'docker-compose.yml', ...(context.stack === 'fabric' ? ['-f', 'docker-compose.ci.yml'] : [])];
  const model = JSON.parse(docker([...args, 'config', '--format', 'json']));
  assert.equal(model.name, context.project);
  assert.equal(model.services.api.environment.FABRIC_ENABLED, 'false');
  assert.equal((model.services.api.volumes ?? []).length, 0);
  assert.equal((model.services.api.secrets ?? []).length, 0);
  assert.notEqual(model.services.api.environment.LEDGER_ROUTE_IMPORT_ENABLED, 'true');
  for (const [key, value] of Object.entries(metadata(route, context.source))) {
    assert.equal(model.services.api.environment[key], value);
    assert.equal(model.services.worker.environment[key], value);
  }
  const id = docker([...args, 'ps', '--quiet', 'postgres']);
  assert.match(id, /^[a-f0-9]{64}$/);
  const [postgres] = JSON.parse(docker(['inspect', id]));
  assert.equal(postgres.Config.Labels['com.docker.compose.project'], context.project);
  assert.equal(postgres.Config.Labels['com.docker.compose.service'], 'postgres');
  const volume = postgres.Mounts.find(mount => mount.Type === 'volume' && mount.Name === context.project + '_postgres-data');
  assert(volume && ['/var/lib/postgresql', '/var/lib/postgresql/data'].includes(volume.Destination));
  const [storage] = JSON.parse(docker(['volume', 'inspect', volume.Name]));
  assert.equal(storage.Labels['com.docker.compose.project'], context.project);
  // No trace writer is started before this point. A populated history requires
  // reviewed import, never automatic assignment by this fresh-DB fixture.
  const fresh = JSON.parse(docker([...args, 'run', '--rm', '--no-deps', 'api', 'node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {PrismaPg} from '@prisma/adapter-pg';
    import {PrismaClient} from './apps/api/dist/generated/prisma/client.js';
    const db = new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
    try {
      assert.equal(await db.traceEvent.count(),0);
      assert.equal(await db.ledgerRouteLegacyRequirement.count(),0);
      assert.equal(await db.ledgerRouteDefinition.count(),0);
      const rows=await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
      assert.equal(rows.length,17);
      console.log(JSON.stringify({fresh:true,migrations:17}));
    } finally { await db.$disconnect(); }
  `]));
  assert.deepEqual(fresh, { fresh: true, migrations: 17 });
  const readiness = [...args, 'run', '--rm', '--no-deps', 'api', 'node', 'apps/api/scripts/check-hybrid-readiness.mjs'];
  let unregisteredRejected = false;
  try { docker(readiness); } catch (error) {
    assert.equal(error.status, 1);
    assert(error.stderr.toString().includes('Hybrid history/active-route readiness failed;'));
    unregisteredRejected = true;
  }
  assert(unregisteredRejected, 'Independent pin alone must not make an unregistered route ready');
  const operator = [...args, 'run', '--rm', '--no-deps', '--user', `${process.getuid()}:${process.getgid()}`,
    '-e', 'LEDGER_ROUTE_IMPORT_ENABLED=true', '-e', 'LEDGER_ROUTE_OPERATOR_ENVIRONMENT=production',
    '--volume', `${join(directory, 'route.json')}:/run/agritrace-ci-route.json:ro`,
    'api', 'node', 'apps/api/scripts/ledger-route-operator.mjs', 'register', '/run/agritrace-ci-route.json'];
  const first = JSON.parse(docker(operator));
  const replay = JSON.parse(docker(operator));
  assert.equal(first.result, 'passed');
  assert.equal(first.digest, route.digest);
  assert.equal(first.alreadyRegistered, false);
  assert.equal(replay.result, 'passed');
  assert.equal(replay.digest, route.digest);
  assert.equal(replay.alreadyRegistered, true);
  const ready = JSON.parse(docker(readiness));
  assert.equal(ready.result, 'passed');
  assert.equal(ready.sourceSha, context.source);
  assert.equal(ready.readOnly, true);
  assert.equal(ready.events, 0);
  assert.equal(ready.sealedLegacyEvents, 0);
  assert.equal(ready.signingMaterialRead, false);
  const receipt = { result: 'passed', sourceSha: context.source, project: context.project,
    definitionDigest: route.digest, registryReplay: true, synthetic: true,
    fabricAcceptance: false, apiSignerAccess: false, operatorGate: 'one-off-only',
    unregisteredRouteRejected: true, readOnlyReadinessPassed: true };
  writeJson(join(directory, 'registration.json'), receipt);
  console.log(JSON.stringify(receipt));
}
async function main() {
  const { values: options, positionals } = parseArgs({ allowPositionals: true, options: {
    stack: { type: 'string' }, directory: { type: 'string' }, env: { type: 'string' },
  } });
  assert.equal(positionals.length, 1);
  assert(['prepare', 'register'].includes(positionals[0]));
  // Refuse non-CI invocations before Git, Docker or any file mutation. The
  // actual checkout SHA is still independently compared after this guard.
  fixtureGuards(process.env, process.env.GITHUB_SHA, options.stack);
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const context = { source, stack: options.stack, project: fixtureGuards(process.env, source, options.stack) };
  execFileSync('git', ['ls-files', '--error-unmatch', 'deploy/hybrid-route-fixture.mjs'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['diff', '--exit-code', '--no-ext-diff', source, '--', 'deploy/hybrid-route-fixture.mjs'], { cwd: root, stdio: 'pipe' });
  if (positionals[0] === 'prepare') prepare(options, context);
  else register(options, context);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch {
    console.error('Disposable CI route fixture failed; no credentials, SQL or private payloads are printed.');
    process.exitCode = 1;
  }
}
