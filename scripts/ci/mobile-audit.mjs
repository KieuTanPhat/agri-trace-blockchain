// Mobile dependency audit with a dated, per-advisory exception list.
// Every advisory at or above `moderate` fails unless listed here and unexpired.
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const exceptions = [
  // node-forge <=1.4.0 has no patched release. Expo CLI uses it only for
  // Expo Updates code signing on build machines; it is not in the app bundle
  // or on any server. Owner accepted a 30-day exception on 27/10/2026.
  { id: 'GHSA-86w9-cpqp-85rv', package: 'node-forge', expires: '2026-11-26' },
];

const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export function evaluateAudit(report, now = new Date(), allowed = exceptions) {
  const failures = [];
  for (const entry of Object.values(report.vulnerabilities ?? {}))
    for (const via of entry.via)
      if (typeof via === 'object' && rank[via.severity] >= rank.moderate) {
        const id = via.url?.split('/').pop();
        const exception = allowed.find(e => e.id === id && e.package === via.name);
        if (!exception) failures.push(`${via.name} ${id} (${via.severity}): ${via.title}`);
        else if (now >= new Date(`${exception.expires}T00:00:00Z`))
          failures.push(`${via.name} ${id}: exception expired on ${exception.expires}`);
      }
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let output;
  try {
    output = execSync('npm audit --workspaces=false --json', { encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    output = error.stdout;
  }
  const failures = evaluateAudit(JSON.parse(output));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(`Mobile audit passed with ${exceptions.length} dated exception(s).`);
}
