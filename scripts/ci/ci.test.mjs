import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  for (const file of ['package-lock.json', 'blockchain/chaincode/package.json', '.github/workflows/dependency-audit.yml', 'scripts/ci/gate.mjs', 'scripts/audit-dependencies.mjs', 'scripts/check-standalone-chaincode.mjs']) {
    assert.ok(Object.values(classifyChanges([file])).every(Boolean), file);
  }
});

test('Web changes select its checks and the production stack', () => {
  assert.deepEqual(classifyChanges(['apps/web/src/app/page.tsx']), {
    api: false, web: true, containers: true, blockchain: false, fabric: false,
  });
});

test('UAT proxy, credentials template and deployment scripts require all integration checks', () => {
  for (const file of ['deploy/Caddyfile.uat', 'deploy/fixtures.mjs', 'deploy/preflight.mjs', '.env.uat.example']) {
    assert.ok(Object.values(classifyChanges([file])).every(Boolean), file);
  }
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

for (const [source, destination, checks] of [
  ['apps/api/src/worker.ts', 'docs/worker.md', ['api', 'containers', 'fabric']],
  ['apps/web/src/view.tsx', 'apps/api/src/view.tsx', ['web', 'api', 'containers', 'fabric']],
  ['blockchain/gateway/src/adapter.ts', 'docs/adapter.md', ['api', 'blockchain', 'containers', 'fabric']],
  ['blockchain/chaincode/src/contract.ts', 'docs/contract.md', ['blockchain', 'fabric']],
]) {
  test(`moving ${source} to ${destination} checks both paths in the actual Git diff`, t => {
    const directory = mkdtempSync(path.join(tmpdir(), 'agri-trace-ci-diff-'));
    t.after(() => {
      const resolved = path.resolve(directory);
      assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
      assert.ok(path.basename(resolved).startsWith('agri-trace-ci-diff-'));
      rmSync(resolved, { recursive: true, force: true });
    });
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    git('config', 'core.hooksPath', path.join(directory, 'no-hooks'));
    git('config', 'user.name', 'CI regression');
    git('config', 'user.email', 'ci@example.invalid');
    const commit = message => {
      git('add', '-A');
      git('-c', 'commit.gpgSign=false', 'commit', '-q', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    mkdirSync(path.dirname(path.join(directory, source)), { recursive: true });
    writeFileSync(path.join(directory, source), 'export const regression = true;\n');
    const before = commit('Before move');
    mkdirSync(path.dirname(path.join(directory, destination)), { recursive: true });
    renameSync(path.join(directory, source), path.join(directory, destination));
    const after = commit('After move');
    const eventFile = path.join(directory, 'event.json');
    writeFileSync(eventFile, JSON.stringify({ pull_request: { base: { sha: before } } }));
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('./changes.mjs', import.meta.url))], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventFile,
        GITHUB_SHA: after, GITHUB_OUTPUT: path.join(directory, 'output.txt'),
      },
    });
    const { changedFiles: files, selected } = JSON.parse(output);
    assert.ok(files.includes(source), 'The removed source must select its dependent checks');
    assert.ok(files.includes(destination), 'The new destination must select its dependent checks');
    for (const check of checks) assert.equal(selected[check], true, check);
  });
}

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
      verify: { result: 'success' }, 'standalone-chaincode': { result: 'success' }, 'fabric-smoke': { result },
    }).length > 0);
  }
});

test('gate fails closed on failed detection, absent outputs and missing jobs', () => {
  assert.ok(gateErrors('application', { changes: { result: 'failure' } }).length > 0);
  assert.ok(gateErrors('application', { changes: { result: 'success', outputs: {} } }).length > 0);
  assert.ok(gateErrors('blockchain', { changes: { result: 'success', outputs: { blockchain: 'true', fabric: 'true' } } }).length > 0);
});

test('blockchain gate requires the selected standalone check and permits documentation skips', () => {
  const needs = {
    changes: { result: 'success', outputs: { blockchain: 'true', fabric: 'true' } },
    verify: { result: 'success' }, 'fabric-smoke': { result: 'success' },
    'standalone-chaincode': { result: 'success' },
  };
  assert.deepEqual(gateErrors('blockchain', needs), []);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.ok(gateErrors('blockchain', { ...needs, 'standalone-chaincode': { result } }).length > 0);
  }
  assert.deepEqual(gateErrors('blockchain', {
    changes: { result: 'success', outputs: { blockchain: 'false', fabric: 'false' } },
    verify: { result: 'skipped' }, 'fabric-smoke': { result: 'skipped' },
    'standalone-chaincode': { result: 'skipped' },
  }), []);
});

test('dependency gate requires both lockfile audits and the installed graph', () => {
  const needs = { audit: { result: 'success' }, 'workspace-peers': { result: 'success' } };
  assert.deepEqual(gateErrors('dependency', needs), []);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    for (const job of ['audit', 'workspace-peers']) {
      assert.ok(gateErrors('dependency', { ...needs, [job]: { result } }).length > 0);
    }
  }
});
