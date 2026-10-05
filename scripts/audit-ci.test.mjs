import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit } from './audit-ci.mjs';

const now = Date.parse('2026-10-05T00:00:00Z');
function fixture() {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      braces: { severity: 'high', nodes: ['node_modules/braces'], via: [{
        name: 'braces', severity: 'high',
        url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
      }] },
      micromatch: { severity: 'high', nodes: ['node_modules/micromatch'], via: ['braces'] },
    },
    metadata: { vulnerabilities: { high: 2, critical: 0 } },
  };
  const lock = { packages: {
    'node_modules/braces': { dev: true },
    'node_modules/micromatch': { dev: true },
  } };
  return { report, lock };
}

test('accepts only the known dev advisory and its propagated finding', () => {
  const { report, lock } = fixture();
  assert.deepEqual(evaluateAudit(report, lock, now).blocked, []);
});
test('blocks the same advisory in production or with missing lock entries', () => {
  for (const entry of [{}, undefined]) {
    const { report, lock } = fixture();
    lock.packages['node_modules/braces'] = entry;
    assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
  }
});
test('blocks new advisories even on an otherwise accepted dependency', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.braces.via.push({ name: 'braces', severity: 'high', url: 'new-advisory' });
  assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
});
test('blocks unrelated high findings while retaining the narrow exception', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.unrelated = {
    severity: 'high', nodes: ['node_modules/unrelated'], via: ['braces'],
  };
  lock.packages['node_modules/unrelated'] = { dev: true };
  report.metadata.vulnerabilities.high = 3;
  assert.deepEqual(evaluateAudit(report, lock, now).blocked, ['unrelated']);
});
test('clean reports pass even after the exception expires', () => {
  const { report, lock } = fixture();
  report.vulnerabilities = {};
  report.metadata.vulnerabilities = { high: 0, critical: 0 };
  assert.deepEqual(evaluateAudit(report, lock, Date.parse('2026-12-01')), {
    blocked: [], accepted: [],
  });
});
test('expires and blocks critical severity', () => {
  const { report, lock } = fixture();
  assert.equal(evaluateAudit(report, lock, Date.parse('2026-11-05')).blocked.length, 2);
  report.vulnerabilities.braces.severity = 'critical';
  report.metadata.vulnerabilities = { high: 1, critical: 1 };
  assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
});
test('fails closed on audit errors, inconsistent counts, and unknown report formats', () => {
  const { report, lock } = fixture();
  for (const invalid of [{ error: {} }, {}, { ...report, auditReportVersion: 3 },
    { ...report, vulnerabilities: {} }]) {
    assert.throws(() => evaluateAudit(invalid, lock, now));
  }
});
test('blocks missing and cyclic dependency causes', () => {
  for (const cause of ['missing', 'micromatch']) {
    const { report, lock } = fixture();
    report.vulnerabilities.braces.via = [cause];
    assert.equal(evaluateAudit(report, lock, now).blocked.length, 2);
  }
});
