// Runs inside the production API image of a disposable CI project (mounted read-only, never baked in).
// It applies the real production provisioning transaction to the runner's isolated database.
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { provisionBusinessCatalog } from '../../apps/api/scripts/bootstrap-production.mjs';

assert.equal(process.env.CI_REHEARSAL, '1', 'Only a CI rehearsal project may run this script');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agri_trace_prod$/, 'Unexpected rehearsal database');

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString());
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const before = await database.user.count();
  await provisionBusinessCatalog(database, input);
  console.log(JSON.stringify({ result: 'passed', usersCreated: (await database.user.count()) - before }));
} catch {
  // The error can quote rows; the caller only needs to know that provisioning failed.
  console.error('Rehearsal provisioning failed; diagnostics withheld');
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
