import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { fixtureRoute, registerFixtureRoute } from '../test/support/ledger-route-fixture.ts';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.HYBRID_DRAFT_TESTS, '1');
assert(process.env.TEST_DATABASE_URL, 'Explicit isolated TEST_DATABASE_URL required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) });
try {
  await registerFixtureRoute(db);
  console.log(JSON.stringify({ ledgerRoutePins: [fixtureRoute.digest], activeRouteDigest: fixtureRoute.digest, synthetic: true }));
} finally { await db.$disconnect(); }
