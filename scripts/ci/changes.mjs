import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sharedFiles = new Set([
  'package.json',
  'package-lock.json',
  '.npmrc',
  '.node-version',
  '.nvmrc',
  '.gitattributes',
  '.dockerignore',
  '.env.docker.example',
  'blockchain/chaincode/package.json',
  'scripts/audit-dependencies.mjs',
  'scripts/check-standalone-chaincode.mjs',
]);

export function classifyChanges(files, force = false) {
  const result = { api: force, web: force, containers: force, blockchain: force, fabric: force };
  for (const file of files) {
    if (sharedFiles.has(file) || file.startsWith('.github/') || file.startsWith('scripts/ci/')) {
      for (const key of Object.keys(result)) result[key] = true;
    }
    if (file.startsWith('apps/api/') || file.startsWith('blockchain/gateway/')) {
      result.api = result.containers = result.fabric = true;
    }
    if (file.startsWith('apps/web/')) result.web = result.containers = true;
    if (file.startsWith('blockchain/')) result.blockchain = result.fabric = true;
    if (/^docker-compose(?:\.[^/]+)?\.ya?ml$/.test(file)) {
      result.containers = result.fabric = true;
    }
  }
  return result;
}

export function changedFiles(eventName, event, sha) {
  // Dispatches, merge queues and pushes without a baseline run every check.
  if (!['push', 'pull_request'].includes(eventName)) return null;
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  if (!base || /^0+$/.test(base)) return null;
  if (!/^[a-f0-9]{40,64}$/.test(base) || !/^[a-f0-9]{40,64}$/.test(sha ?? '')) {
    throw new Error('Invalid CI comparison SHA');
  }
  // Treat a rename as deletion + addition so both source and destination
  // select their dependent checks, including moves across workspace boundaries.
  const diff = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, sha], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return diff.split('\0').filter(Boolean);
}

function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const files = changedFiles(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_SHA);
  const selected = classifyChanges(files ?? [], files === null);
  console.log(JSON.stringify({ changedFiles: files, selected }, null, 2));
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(selected).map(([key, value]) => `${key}=${value}\n`).join(''));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
