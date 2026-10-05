import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const advisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const expires = Date.parse('2026-11-05T00:00:00Z');
const lintPackages = new Set([
  'braces', 'micromatch', 'fast-glob', '@next/eslint-plugin-next', 'eslint-config-next',
]);

// Only this unpatched advisory in the development-only Next lint chain is accepted.
// See docs/security-audit.md. Unknown reports and dependency paths fail closed.
export function evaluateAudit(report, lock, now = Date.now()) {
  if (report.error || report.auditReportVersion !== 2 ||
      !report.vulnerabilities || !report.metadata?.vulnerabilities || !lock.packages) {
    throw new Error('Invalid npm audit report or lockfile');
  }
  const findings = report.vulnerabilities;
  function excepted(name, visited = new Set()) {
    const item = findings[name];
    if (now >= expires || visited.has(name) || !lintPackages.has(name) ||
        !item || item.severity !== 'high' || !item.nodes?.length || !item.via?.length ||
        !item.nodes.every((path) => lock.packages[path]?.dev === true)) return false;
    const next = new Set([...visited, name]);
    return item.via.every((cause) => typeof cause === 'string'
      ? excepted(cause, next)
      : name === 'braces' && cause.name === 'braces' &&
        cause.url === advisory && cause.severity === 'high');
  }
  const severe = Object.keys(findings).filter((name) =>
    ['high', 'critical'].includes(findings[name].severity));
  if (severe.length !== report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical) {
    throw new Error('Inconsistent npm audit severity counts');
  }
  return {
    blocked: severe.filter((name) => !excepted(name)),
    accepted: severe.filter((name) => excepted(name)),
  };
}

function main() {
  if (!process.env.npm_execpath) throw new Error('Run through npm run audit:ci');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], {
    cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(result.error?.message || result.stderr || 'npm audit failed');
  }
  const report = JSON.parse(result.stdout);
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const { blocked, accepted } = evaluateAudit(report, lock);
  if (accepted.length) {
    console.warn(`Temporary dev-only exception until 2026-11-05: ${advisory}\nAffected: ${accepted.join(', ')}`);
  }
  if (blocked.length) {
    console.error(JSON.stringify(report, null, 2));
    throw new Error(`Unaccepted high/critical findings: ${blocked.join(', ')}`);
  }
  console.log('Security audit passed under the documented CI policy.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
