import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// A private fork is not automatically covered by npm's upstream package name.
// Keep querying that name; recognize only the advisory fixed by this reviewed
// parser after checking the source and running its regression tests.
const fixedAdvisory = 'GHSA-fc5q-39xc-vjpf';
const patchedParser = '7364b66c0f8e5aa5f8cd4cf55cc3ef14d294fcf5c5968de33dd63c66b6cc10c8';

export function unresolvedAdvisories(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      Object.keys(report).some(key => key !== 'picomatch') ||
      (report.picomatch !== undefined && !Array.isArray(report.picomatch)))
    throw new Error('Invalid upstream picomatch advisory report');
  return (report.picomatch ?? []).filter(advisory => {
    if (!advisory || !['info','low','moderate','high','critical'].includes(advisory.severity) ||
        typeof advisory.url !== 'string') throw new Error('Invalid upstream picomatch advisory');
    if (advisory.url === `https://github.com/advisories/${fixedAdvisory}`) return false;
    return ['moderate','high','critical'].includes(advisory.severity);
  });
}

export async function auditPatchedMatcher(cwd) {
  const require = createRequire(path.join(cwd, 'package.json'));
  const directory = path.dirname(require.resolve('picomatch/package.json'));
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json')));
  const provenance = JSON.parse(readFileSync(path.join(directory, 'UPSTREAM.json')));
  if (manifest.name !== '@agritrace/picomatch-safe' || manifest.version !== '4.0.7' ||
      provenance.package !== 'picomatch' || provenance.version !== '4.0.7' ||
      provenance.files?.['lib/parse.js'] !== patchedParser)
    throw new Error('Unreviewed picomatch fork or parser');
  for (const [file, expected] of Object.entries(provenance.files)) {
    if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Invalid matcher provenance path');
    const actual = createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex');
    if (actual !== expected) throw new Error(`Patched picomatch source differs: ${file}`);
  }
  const regression = spawnSync(process.execPath,
    ['--test', path.join(directory, 'test/security.test.cjs')],
    { timeout: 10_000, encoding: 'utf8' });
  if (regression.error || regression.status !== 0)
    throw new Error(`Patched picomatch regression failed: ${regression.error?.message ?? regression.stderr}`);
  const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ picomatch: ['4.0.7'] }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Upstream picomatch audit HTTP ${response.status}`);
  const report = await response.json();
  const unresolved = unresolvedAdvisories(report);
  if (unresolved.length) throw new Error(unresolved.map(a => `${a.url} (${a.severity}): ${a.title}`).join('\n'));
  return { upstream: 'picomatch@4.0.7', fixedAdvisory, parserSha256: patchedParser,
    sourceVerified: true, regressionPassed: true, advisories: report.picomatch ?? [] };
}
