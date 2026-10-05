import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyChanges, changedFiles } from './changes.mjs';
import { gateErrors } from './gate.mjs';

test('Gateway changes run API, containers and real Fabric integration', () => {
  assert.deepEqual(classifyChanges(['blockchain/gateway/src/adapter.ts']), {
    api: true, web: false, containers: true, blockchain: true, fabric: true,
  });
});

test('API and Worker changes run real Fabric integration', () => {
  for (const file of ['apps/api/src/worker-main.ts', 'apps/api/prisma/schema.prisma']) {
    const selected = classifyChanges([file]);
    assert.equal(selected.api, true);
    assert.equal(selected.containers, true);
    assert.equal(selected.fabric, true);
  }
});

test('network and chaincode changes select blockchain integration', () => {
  for (const file of ['blockchain/network/network.sh', 'blockchain/chaincode/src/traceability-contract.ts']) {
    assert.equal(classifyChanges([file]).blockchain, true);
    assert.equal(classifyChanges([file]).fabric, true);
  }
});

test('manifests and CI changes select all checks', () => {
  for (const file of ['package-lock.json', 'blockchain/chaincode/package.json', '.github/workflows/dependency-audit.yml', 'scripts/ci/gate.mjs']) {
    assert.ok(Object.values(classifyChanges([file])).every(Boolean), file);
  }
});

test('Web changes select its checks and the production stack', () => {
  assert.deepEqual(classifyChanges(['apps/web/src/app/page.tsx']), {
    api: false, web: true, containers: true, blockchain: false, fabric: false,
  });
});

test('Compose overrides select production and Fabric integration', () => {
  for (const file of ['docker-compose.yml', 'docker-compose.ci.yml']) {
    assert.equal(classifyChanges([file]).containers, true);
    assert.equal(classifyChanges([file]).fabric, true);
  }
});

test('documentation-only PRs skip expensive jobs without leaving gates pending', () => {
  assert.ok(Object.values(classifyChanges(['README.md', 'docs/ci.md'])).every(value => value === false));
  assert.deepEqual(gateErrors('application', {
    changes: { result: 'success', outputs: { api: 'false', web: 'false', containers: 'false' } },
    api: { result: 'skipped' }, web: { result: 'skipped' }, 'container-build': { result: 'skipped' },
  }), []);
});

test('dispatch, merge queue and missing push baselines run everything', () => {
  for (const [event, payload] of [['workflow_dispatch', {}], ['merge_group', {}], ['push', { before: '0'.repeat(40) }]]) {
    assert.equal(changedFiles(event, payload, 'a'.repeat(40)), null);
    assert.ok(Object.values(classifyChanges([], true)).every(Boolean));
  }
});

test('gate rejects failures, cancellation and unexpected skips for selected jobs', () => {
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.ok(gateErrors('blockchain', {
      changes: { result: 'success', outputs: { blockchain: 'true', fabric: 'true' } },
      verify: { result: 'success' }, 'fabric-smoke': { result },
    }).length > 0);
  }
});

test('gate fails closed on failed detection, absent outputs and missing jobs', () => {
  assert.ok(gateErrors('application', { changes: { result: 'failure' } }).length > 0);
  assert.ok(gateErrors('application', { changes: { result: 'success', outputs: {} } }).length > 0);
  assert.ok(gateErrors('blockchain', { changes: { result: 'success', outputs: { blockchain: 'true', fabric: 'true' } } }).length > 0);
});

test('dependency gate requires success from both audits in the matrix', () => {
  assert.deepEqual(gateErrors('dependency', { audit: { result: 'success' } }), []);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.ok(gateErrors('dependency', { audit: { result } }).length > 0);
  }
});
