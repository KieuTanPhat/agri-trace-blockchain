import { pathToFileURL } from 'node:url';

const selectedJobs = {
  application: { api: 'api', web: 'web', 'container-build': 'containers' },
  blockchain: { verify: 'blockchain', 'fabric-smoke': 'fabric' },
};

export function gateErrors(kind, needs) {
  if (kind === 'dependency') {
    return needs.audit?.result === 'success' ? [] : ['Both dependency audits must succeed'];
  }
  const jobs = selectedJobs[kind];
  if (!jobs) throw new Error(`Unknown CI gate: ${kind}`);
  if (needs.changes?.result !== 'success') return ['Change detection did not succeed'];
  const errors = [];
  for (const [job, output] of Object.entries(jobs)) {
    const selected = needs.changes.outputs?.[output];
    if (!['true', 'false'].includes(selected)) {
      errors.push(`Missing or invalid change selection: ${output}`);
      continue;
    }
    const expected = selected === 'true' ? 'success' : 'skipped';
    if (needs[job]?.result !== expected) {
      errors.push(`${job}: expected ${expected}, got ${needs[job]?.result ?? 'missing'}`);
    }
  }
  return errors;
}

function main() {
  const needs = JSON.parse(process.env.CI_NEEDS ?? '{}');
  const errors = gateErrors(process.argv[2], needs);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`${process.argv[2]} gate passed`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
