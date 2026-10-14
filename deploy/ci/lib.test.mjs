import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import './smoke.test.mjs';
import { fileURLToPath } from 'node:url';
import { composeModelErrors, migrationChecksums, migrationErrors, ownedResources, proxyCaddyfile, rehearsalIdentity } from './lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const github = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' };

test('rehearsal resources are owned by one GitHub run and never by a developer machine', () => {
  assert.deepEqual(rehearsalIdentity(github), {
    project: 'agritrace-prod-ci-123-2', ingress: 'agritrace-prod-ci-123-2-ingress',
    volume: 'agritrace-prod-ci-123-2-postgres', imageTag: 'agritrace-ci-123-2',
  });
  assert.throws(() => rehearsalIdentity({ ...github, GITHUB_ACTIONS: undefined }), /disposable GitHub runners/);
  for (const bad of ['', '1; rm', '../1']) {
    assert.throws(() => rehearsalIdentity({ ...github, GITHUB_RUN_ID: bad }));
    assert.throws(() => rehearsalIdentity({ ...github, GITHUB_RUN_ATTEMPT: bad }));
  }
});

test('owned resources are found by the Compose project label and a clean runner reports none', () => {
  const calls = [];
  const exec = (file, args) => { calls.push([file, ...args].join(' ')); return args[0] === 'ps' ? 'abc\ndef\n' : ''; };
  assert.deepEqual(ownedResources(exec, 'agritrace-prod-ci-1-1'), ['container:abc', 'container:def']);
  assert.ok(calls.every(call => call.endsWith('--filter label=com.docker.compose.project=agritrace-prod-ci-1-1')));
  assert.deepEqual(ownedResources(() => '', 'agritrace-prod-ci-1-1'), []);
});

test('the CI proxy reuses the real production routing snippet and hides API documentation', () => {
  const production = readFileSync(new URL('../edge/Caddyfile', import.meta.url), 'utf8');
  const derived = proxyCaddyfile(production);
  assert.match(derived, /^\{\n\s+admin unix/);
  assert.ok(derived.includes(production.slice(production.indexOf('(application) {'), production.indexOf('agritrace.dev,')).trim()));
  assert.match(derived, /:80 \{\n\s+import application prod-api prod-web\n\}/);
  assert.ok(!derived.includes('agritrace.dev'), 'Production hostnames must not leak into the HTTP rehearsal');
  assert.ok(!derived.includes('13.140.170.166'));
});

test('a production Caddyfile that loses its documentation block or snippet fails the rehearsal loudly', () => {
  const production = readFileSync(new URL('../edge/Caddyfile', import.meta.url), 'utf8');
  assert.throws(() => proxyCaddyfile(production.replace('respond "Not found" 404', 'respond "ok" 200')), /documentation must stay hidden/);
  assert.throws(() => proxyCaddyfile(production.replace('(application) {', '(app) {')), /no longer defines/);
  assert.throws(() => proxyCaddyfile(production.replace(/^\{\n[\s\S]*?\n\}\n/, '')), /global options/);
});

test('repository migration checksums are SHA-256 of each migration.sql in name order', () => {
  const checksums = migrationChecksums(root);
  const names = Object.keys(checksums);
  assert.ok(names.length > 0);
  assert.deepEqual(names, [...names].sort());
  for (const digest of Object.values(checksums)) assert.match(digest, /^[a-f0-9]{64}$/);
});

test('applied migrations must match the repository exactly and be finished', () => {
  const expected = { a: '1'.repeat(64), b: '2'.repeat(64) };
  const row = (name, checksum, extra = {}) => ({ migration_name: name, checksum, finished_at: '2026-01-01', rolled_back_at: null, ...extra });
  assert.deepEqual(migrationErrors([row('a', expected.a), row('b', expected.b)], expected), []);
  assert.deepEqual(migrationErrors([row('a', expected.a)], expected), ['b: not applied']);
  assert.deepEqual(migrationErrors([row('a', expected.a), row('b', '3'.repeat(64))], expected), ['b: applied checksum differs from the repository']);
  assert.deepEqual(migrationErrors([row('a', expected.a), row('b', expected.b, { finished_at: null })], expected), ['b: not finished']);
  assert.deepEqual(migrationErrors([row('a', expected.a), row('b', expected.b), row('c', 'x')], expected), ['c: applied but absent from the repository']);
});

test('the Compose model must keep quotas, loopback-only publishing and the reviewed service set', () => {
  const options = { project: 'p', services: ['postgres', 'api', 'proxy'] };
  const good = {
    name: 'p',
    services: {
      postgres: { mem_limit: '402653184', cpus: 1 },
      api: { mem_limit: 402653184, cpus: 1 },
      proxy: { mem_limit: '134217728', cpus: 0.5, ports: [{ host_ip: '127.0.0.1', published: '18080', target: 80 }] },
    },
  };
  assert.deepEqual(composeModelErrors(good, options), []);
  assert.match(composeModelErrors({ ...good, name: 'q' }, options)[0], /Compose project/);
  const noQuota = structuredClone(good);
  delete noQuota.services.api.mem_limit;
  noQuota.services.api.cpus = 0;
  assert.deepEqual(composeModelErrors(noQuota, options), ['api: memory quota missing', 'api: CPU quota missing']);
  const exposed = structuredClone(good);
  exposed.services.postgres.ports = [{ host_ip: '127.0.0.1', published: '5432', target: 5432 }];
  exposed.services.proxy.ports = [{ host_ip: '0.0.0.0', published: '18080', target: 80 }];
  assert.deepEqual(composeModelErrors(exposed, options), ['postgres: unexpected published port', 'proxy: unexpected published port']);
  assert.match(composeModelErrors({ ...good, services: { ...good.services, extra: { mem_limit: 1, cpus: 1 } } }, options)[0], /Unexpected services/);
  const privileged = structuredClone(good);
  privileged.services.api.privileged = true;
  assert.deepEqual(composeModelErrors(privileged, options), ['api: unexpected privilege']);
});
