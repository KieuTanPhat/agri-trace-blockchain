// A migration that production (or any retained database) may already have applied must never change:
// its checksum is recorded in _prisma_migrations and pinned by release manifests. New migrations are
// additions only. This compares a pull request with its base and fails on any other change.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIGRATIONS = 'apps/api/prisma/migrations/';

/** `diff` is the NUL-separated output of `git diff --no-renames --name-status -z`. */
export function migrationViolations(diff) {
  const fields = diff.split('\0').filter(Boolean);
  const violations = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [status, file] = [fields[index], fields[index + 1]];
    if (!file.startsWith(MIGRATIONS)) continue;
    // The lock file at the migrations root is Prisma's provider marker; every file below a migration folder is history.
    if (status !== 'A' && file.slice(MIGRATIONS.length).includes('/')) violations.push(`${status} ${file}`);
  }
  return violations;
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    console.log('Migration immutability is checked on pull requests; main pushes are already merged history.');
    return;
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event.pull_request?.base?.sha;
  const head = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40,64}$/.test(base ?? '') || !/^[a-f0-9]{40,64}$/.test(head ?? '')) throw new Error('Invalid comparison SHA');
  const diff = execFileSync('git', ['diff', '--no-renames', '--name-status', '-z', base, head, '--', MIGRATIONS], { encoding: 'utf8' });
  const violations = migrationViolations(diff);
  if (violations.length) {
    console.error(`Applied migrations are immutable; add a new migration instead:\n${violations.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('No existing migration was modified, renamed or deleted.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
