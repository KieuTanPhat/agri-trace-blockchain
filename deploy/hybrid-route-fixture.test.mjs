import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fixtureGuards, technicalFixtureRoute } from './hybrid-route-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = 'a'.repeat(40);
const baseline = {
  GITHUB_ACTIONS: 'true', HYBRID_CONTAINER_TESTS: '1', GITHUB_RUN_ID: '123',
  GITHUB_SHA: source, COMPOSE_PROJECT_NAME: 'agri-trace-ci',
};

test('the technical route keeps the reviewed public RFC8785 vector and explicit logical authority', () => {
  assert.deepEqual(technicalFixtureRoute(), {
    protocol: 'agritrace-ledger-route/1', mode: 'WRITE', network: 'hyperledger-fabric',
    channelId: 'agritrace', chaincodeName: 'agritrace', contractName: 'AgriTraceContract',
    envelopeVersion: '3.0.0', writerAuthority: 'isolated:technical-relayer',
    writerMspId: 'Org1MSP', writerRole: 'relayer',
    digest: '5b659d7078626eb50f5ea16bb37387cb3a30afcabc06a5de1bb7bd16627fb6b7',
  });
});

test('only the three named ephemeral CI projects pass the fixture guard', () => {
  for (const [stack, project] of Object.entries({ standard: 'agri-trace-ci', uat: 'agri-trace-uat-ci', fabric: 'agri-trace-fabric-ci' })) {
    assert.equal(fixtureGuards({ ...baseline, COMPOSE_PROJECT_NAME: project }, source, stack), project);
  }
});

for (const [reason, patch] of [
  ['a local machine', { GITHUB_ACTIONS: 'false' }],
  ['missing explicit fixture opt-in', { HYBRID_CONTAINER_TESTS: '0' }],
  ['missing runner identity', { GITHUB_RUN_ID: '' }],
  ['another source SHA', { GITHUB_SHA: 'b'.repeat(40) }],
  ['the retained production Compose project', { COMPOSE_PROJECT_NAME: 'agri-trace-uat' }],
  ['a remote Docker daemon', { DOCKER_HOST: 'ssh://production' }],
  ['Docker TLS overrides', { DOCKER_TLS_VERIFY: '1' }],
  ['the production origin', { CI_API_URL: 'https://agritrace.dev/api' }],
  ['a public IP origin', { CI_API_URL: 'http://13.140.170.166/api' }],
  ['credentials embedded in a loopback origin', { CI_API_URL: 'http://user:withheld@localhost/api' }],
]) {
  test(`the fixture refuses ${reason}`, () => {
    assert.throws(() => fixtureGuards({ ...baseline, ...patch }, source, 'standard'));
  });
}
test('the fixture refuses an unknown deployment stack', () => {
  assert.throws(() => fixtureGuards(baseline, source, 'production'));
});

test('the CLI rejects outside GitHub before writing files and keeps credentials out of diagnostics', t => {
  const evidence = join(root, '.codex', 'evidence');
  const destination = join(evidence, 'ci-route-negative-guard-' + randomUUID());
  t.after(() => {
    const checked = resolve(destination);
    assert(checked.startsWith(resolve(evidence) + sep));
    assert(checked.slice(resolve(evidence).length + 1).startsWith('ci-route-negative-guard-'));
    if (existsSync(checked)) rmSync(checked, { recursive: true, force: true });
  });
  const result = spawnSync(process.execPath, [join(root, 'deploy/hybrid-route-fixture.mjs'), 'prepare',
    '--stack', 'standard', '--directory', destination], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...baseline,
      GITHUB_ACTIONS: 'false', DATABASE_URL: 'postgresql://withheld:private-fixture-placeholder@production/db',
      JWT_SECRET: 'private-fixture-placeholder' },
  });
  assert.equal(result.status, 1);
  assert.equal(existsSync(destination), false, 'The rejected invocation must not create an evidence directory');
  assert(!`${result.stdout}${result.stderr}`.includes('private-fixture-placeholder'));
  assert(result.stderr.includes('Disposable CI route fixture failed'));
});
