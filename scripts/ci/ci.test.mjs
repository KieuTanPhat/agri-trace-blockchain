import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { classifyChanges, changedFiles } from './changes.mjs';
import { gateErrors } from './gate.mjs';
import { auditErrors } from './audit-mobile.mjs';
import './hybrid-browser-login.test.mjs';
import { approvalPolicy, verifyApprovedDefinition } from '../../blockchain/network/enterprise/peer.mjs';

test('enterprise approval recovery rejects a changed policy, package or definition', () => {
  const spec = { chaincodeVersion: 'reviewed-1', chaincodeSequence: 1, endorsementPolicy: "AND('Org1MSP.peer','Org3MSP.peer')" };
  const policy = 'reviewed-policy-bytes';
  const approved = { version: 'reviewed-1', sequence: 1, endorsement_plugin: 'escc', validation_plugin: 'vscc',
    validation_parameter: policy, source: { Type: { LocalPackage: { package_id: 'reviewed-package' } } } };
  verifyApprovedDefinition(spec, approved, 'reviewed-package', policy);
  for (const patch of [{ version: 'other' }, { sequence: 2 }, { validation_parameter: 'weakened-policy' },
    { endorsement_plugin: 'custom' }, { validation_plugin: 'custom' }, { init_required: true },
    { collections: { config: [{}] } }, { source: { Type: { LocalPackage: { package_id: 'other-package' } } } },
    { source: { Type: { Unavailable: {} } } }])
    assert.throws(() => verifyApprovedDefinition(spec, { ...approved, ...patch }, 'reviewed-package', policy));
  assert.deepEqual(approvalPolicy(spec).signature_policy.rule,
    { n_out_of: { n: 2, rules: [{ signed_by: 0 }, { signed_by: 1 }] } });
  assert.deepEqual(approvalPolicy(spec).signature_policy.identities.map(value => value.principal),
    [{ msp_identifier: 'Org1MSP', role: 'PEER' }, { msp_identifier: 'Org3MSP', role: 'PEER' }]);
  for (const endorsementPolicy of ["OR('Org1MSP.peer','Org3MSP.peer')", "AND('Org3MSP.peer','Org3MSP.peer')"])
    assert.throws(() => approvalPolicy({ ...spec, endorsementPolicy }));
});

test('Gateway changes run API, containers and real Fabric integration', () => {
  assert.deepEqual(classifyChanges(['blockchain/gateway/src/adapter.ts']), {
    api: true, web: false, mobile: false, containers: true, blockchain: true, fabric: true, hybrid: true,
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
  for (const file of ['package-lock.json', 'blockchain/chaincode/package.json', '.github/workflows/dependency-audit.yml', 'scripts/ci/gate.mjs', 'scripts/audit-dependencies.mjs', 'scripts/check-standalone-chaincode.mjs', 'scripts/ci/audit-mobile.mjs']) {
    assert.ok(Object.values(classifyChanges([file])).every(Boolean), file);
  }
});

test('Web changes select its checks and the production stack', () => {
  assert.deepEqual(classifyChanges(['apps/web/src/app/page.tsx']), {
    api: false, web: true, mobile: false, containers: true, blockchain: false, fabric: false, hybrid: true,
  });
});

test('mobile app changes run only the mobile checks', () => {
  for (const file of ['apps/mobile/app/index.tsx', 'apps/mobile/package-lock.json', 'apps/mobile/audit-exceptions.json']) {
    assert.deepEqual(classifyChanges([file]), {
      api: false, web: false, mobile: true, containers: false, blockchain: false, fabric: false, hybrid: false,
    }, file);
  }
});

test('the generated API contract also selects the mobile consumer', () => {
  for (const file of ['docs/openapi/openapi.json', 'apps/web/src/lib/generated/api.d.ts', 'apps/mobile/src/api/generated/api.d.ts']) {
    const selected = classifyChanges([file]);
    assert.equal(selected.api, true, file);
    assert.equal(selected.web, true, file);
    assert.equal(selected.mobile, true, file);
  }
});

test('mobile audit blocks unlisted, expired and stale advisories', () => {
  const report = { vulnerabilities: {
    braces: { via: [{ name: 'braces', severity: 'high', title: 'DoS', url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }] },
    micromatch: { via: ['braces'] },
    low: { via: [{ name: 'low', severity: 'low', title: 'minor', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }] },
  } };
  const entry = { id: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', reason: 'No fixed release', reviewBy: '2026-11-16' };
  assert.deepEqual(auditErrors(report, { advisories: [entry] }, '2026-10-16'), []);
  assert.match(auditErrors(report, { advisories: [] }, '2026-10-16').join(), /GHSA-vfj7-8cjw-p6xm high in braces/);
  assert.match(auditErrors(report, { advisories: [entry] }, '2026-11-17').join(), /expired/);
  assert.match(auditErrors({ vulnerabilities: {} }, { advisories: [entry] }, '2026-10-16').join(), /no longer occurs/);
  assert.match(auditErrors(report, { advisories: [{ ...entry, reason: ' ' }] }, '2026-10-16').join(), /Invalid exception/);
  assert.match(auditErrors(report, { advisories: [{ ...entry, package: 'other' }] }, '2026-10-16').join(), /listed for other/);
  assert.throws(() => auditErrors({}, { advisories: [] }, '2026-10-16'));
});

test('the committed mobile audit exceptions are well formed and dated', () => {
  const exceptions = JSON.parse(readFileSync(new URL('../../apps/mobile/audit-exceptions.json', import.meta.url), 'utf8'));
  assert.ok(exceptions.advisories.length > 0);
  for (const entry of exceptions.advisories) {
    assert.match(entry.id, /^GHSA-/);
    assert.ok(entry.reason.length > 40, entry.id);
    assert.match(entry.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('edge routing, rehearsal scripts and the deployment template require all integration checks', () => {
  for (const file of ['deploy/edge/Caddyfile', 'deploy/ci/rehearse.mjs', 'deploy/cd/policy.py', '.env.deploy.example']) {
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
    changes: { result: 'success', outputs: { api: 'false', web: 'false', mobile: 'false', containers: 'false' } },
    api: { result: 'skipped' }, web: { result: 'skipped' }, mobile: { result: 'skipped' }, 'container-build': { result: 'skipped' }, rehearsal: { result: 'skipped' },
  }), []);
});

test('agent-only PRs use the always-run setup check without selecting runtime jobs', () => {
  const agentFiles = ['AGENTS.md', 'CLAUDE.md', 'docs/agent-workflow.md',
    '.agents/skills/agritrace-api-contract/SKILL.md', '.claude/skills/agritrace-api-contract/SKILL.md',
    '.claude/skills/.generated-skills.json', '.claude/settings.json', '.codex/config.toml',
    '.codex/agents/agritrace-reviewer.toml', 'scripts/sync-agent-skills.mjs',
    'scripts/check-agent-setup.mjs', 'scripts/agent-setup.test.mjs'];
  assert.ok(Object.values(classifyChanges(agentFiles)).every(value => value === false));
  assert.deepEqual(classifyChanges([...agentFiles, 'apps/api/src/main.ts']), classifyChanges(['apps/api/src/main.ts']));
  assert.deepEqual(classifyChanges([...agentFiles, 'apps/web/src/app/page.tsx']), classifyChanges(['apps/web/src/app/page.tsx']));
  assert.ok(Object.values(classifyChanges(agentFiles, true)).every(Boolean), 'main/dispatch/merge queue must still run all jobs');
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

test('main pushes with a valid baseline still require every check for the deployable SHA', () => {
  // A documentation push after a failed code push must not create green gates
  // that let CD deploy the unverified code from the preceding commit.
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const files = changedFiles('push', { before: sha }, sha);
  assert.equal(files, null);
  assert.ok(Object.values(classifyChanges(files ?? [], files === null)).every(Boolean));
});

test('gate rejects failures, cancellation and unexpected skips for selected jobs', () => {
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.ok(gateErrors('blockchain', {
      changes: { result: 'success', outputs: { blockchain: 'true', fabric: 'true', hybrid: 'true' } },
      verify: { result: 'success' }, 'standalone-chaincode': { result: 'success' }, 'hybrid-fabric': { result: 'success' }, 'fabric-smoke': { result },
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
    changes: { result: 'success', outputs: { blockchain: 'true', fabric: 'true', hybrid: 'true' } },
    verify: { result: 'success' }, 'fabric-smoke': { result: 'success' },
    'standalone-chaincode': { result: 'success' }, 'hybrid-fabric': { result: 'success' },
  };
  assert.deepEqual(gateErrors('blockchain', needs), []);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.ok(gateErrors('blockchain', { ...needs, 'standalone-chaincode': { result } }).length > 0);
  }
  assert.deepEqual(gateErrors('blockchain', {
    changes: { result: 'success', outputs: { blockchain: 'false', fabric: 'false', hybrid: 'false' } },
    verify: { result: 'skipped' }, 'fabric-smoke': { result: 'skipped' },
    'standalone-chaincode': { result: 'skipped' }, 'hybrid-fabric': { result: 'skipped' },
  }), []);
});

test('dependency gate requires every lockfile audit and the installed graph', () => {
  const needs = { audit: { result: 'success' }, 'mobile-audit': { result: 'success' }, 'workspace-peers': { result: 'success' } };
  assert.deepEqual(gateErrors('dependency', needs), []);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    for (const job of ['audit', 'mobile-audit', 'workspace-peers']) {
      assert.ok(gateErrors('dependency', { ...needs, [job]: { result } }).length > 0);
    }
  }
});

test('application gate requires the production rehearsal whenever containers are selected', () => {
  const needs = {
    changes: { result: 'success', outputs: { api: 'true', web: 'true', mobile: 'true', containers: 'true' } },
    api: { result: 'success' }, web: { result: 'success' }, mobile: { result: 'success' }, 'container-build': { result: 'success' }, rehearsal: { result: 'success' },
  };
  assert.deepEqual(gateErrors('application', needs), []);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.ok(gateErrors('application', { ...needs, rehearsal: { result } }).length > 0);
    assert.ok(gateErrors('application', { ...needs, mobile: { result } }).length > 0);
  }
});

test('the local Compose stack passes an explicit business write mode to the API', () => {
  const compose = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
  const api = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  worker:'));
  assert.match(api, /HYBRID_WRITES_MODE: \$\{HYBRID_WRITES_MODE:-OPEN\}/);
  assert.match(readFileSync(new URL('../../.env.docker.example', import.meta.url), 'utf8'), /^HYBRID_WRITES_MODE=OPEN$/m);
});
