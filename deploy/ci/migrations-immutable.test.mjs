import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrationViolations } from './migrations-immutable.mjs';

const diff = (...entries) => entries.flatMap(([status, file]) => [status, file]).join('\0') + '\0';
const base = 'apps/api/prisma/migrations/';

test('adding a migration is allowed', () => {
  assert.deepEqual(migrationViolations(diff(['A', `${base}20261020000000_next/migration.sql`])), []);
});

test('modifying, deleting or type-changing an existing migration file is a violation', () => {
  const file = `${base}20261010000000_core/migration.sql`;
  for (const status of ['M', 'D', 'T']) assert.deepEqual(migrationViolations(diff([status, file])), [`${status} ${file}`]);
});

test('a rename appears as a deletion plus an addition and is therefore rejected', () => {
  const result = migrationViolations(diff(['D', `${base}old/migration.sql`], ['A', `${base}new/migration.sql`]));
  assert.deepEqual(result, [`D ${base}old/migration.sql`]);
});

test('unrelated files and Prisma\'s provider lock do not matter', () => {
  assert.deepEqual(migrationViolations(diff(['M', 'apps/api/src/main.ts'], ['M', `${base}migration_lock.toml`])), []);
  assert.deepEqual(migrationViolations(''), []);
});
