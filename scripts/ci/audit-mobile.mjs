import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mobile = path.join(root, 'apps/mobile');
const BLOCKING = new Set(['moderate', 'high', 'critical']);

/** Source advisories (moderate and above) in an `npm audit --json` report, keyed by GHSA id. */
export function blockingAdvisories(report) {
  if (!report?.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    throw new Error('npm audit did not return a vulnerability report');
  }
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const id = /\/(GHSA-[a-z0-9-]+)$/i.exec(via.url ?? '')?.[1];
      if (!id) throw new Error(`Advisory for ${via.name} has no GHSA id: ${via.url}`);
      found.set(id, { id, package: via.name, severity: via.severity, title: via.title, range: via.range });
    }
  }
  return found;
}

/**
 * Every blocking advisory must be listed with a reason and a review date that has
 * not passed; listed advisories that no longer occur must be removed.
 */
export function auditErrors(report, exceptions, today) {
  const errors = [];
  const found = blockingAdvisories(report);
  const listed = new Map();
  for (const entry of exceptions.advisories ?? []) {
    if (!/^GHSA-[a-z0-9-]+$/i.test(entry.id ?? '') || !entry.package || !entry.reason?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy ?? '')) {
      errors.push(`Invalid exception entry: ${JSON.stringify(entry)}`);
      continue;
    }
    listed.set(entry.id, entry);
    if (entry.reviewBy < today) errors.push(`${entry.id} (${entry.package}) exception expired on ${entry.reviewBy}`);
    if (!found.has(entry.id)) errors.push(`${entry.id} (${entry.package}) no longer occurs; remove its exception`);
  }
  for (const advisory of found.values()) {
    const entry = listed.get(advisory.id);
    if (!entry) errors.push(`${advisory.id} ${advisory.severity} in ${advisory.package}: ${advisory.title}`);
    else if (entry.package !== advisory.package) errors.push(`${advisory.id} is listed for ${entry.package}, found in ${advisory.package}`);
  }
  return errors;
}

function main() {
  const output = path.resolve(root, process.argv[2] ?? '.codex/evidence/dependencies/mobile');
  if (!process.env.npm_execpath) throw new Error('Run through npm run audit:mobile');
  // --prefix keeps the audit on the standalone mobile lockfile, not the root workspace.
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, '--prefix', mobile, 'audit', '--package-lock-only', '--json'],
    { cwd: mobile, encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 },
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit did not return JSON: ${result.error?.message ?? result.stderr}`);
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
  const exceptions = JSON.parse(readFileSync(path.join(mobile, 'audit-exceptions.json'), 'utf8'));
  const errors = auditErrors(report, exceptions, new Date().toISOString().slice(0, 10));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Mobile lockfile audit passed with ${exceptions.advisories.length} reviewed exception(s).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
