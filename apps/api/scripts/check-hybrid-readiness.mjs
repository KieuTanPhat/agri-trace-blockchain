import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import {
  assertPinnedLedgerRoute,
  EVENT_LEDGER_ROUTE_INCLUDE,
  routeProofMatches,
  verifiedEventRoute,
} from '../dist/modules/trace/ledger-route.js';

let database;
try {
  assert.equal(process.env.NODE_ENV, 'production');
  assert.equal(process.env.FABRIC_ENABLED, 'false');
  assert.notEqual(process.env.LEDGER_ROUTE_IMPORT_ENABLED, 'true');
  assert.match(process.env.APP_RELEASE_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.match(process.env.LEDGER_ACTIVE_ROUTE_DIGEST ?? '', /^[a-f0-9]{64}$/);
  database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const result = await database.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const active = await tx.ledgerRouteDefinition.findUniqueOrThrow({
        where: { digest: process.env.LEDGER_ACTIVE_ROUTE_DIGEST },
      });
      assert.equal(assertPinnedLedgerRoute(active).mode, 'WRITE');
      // Registration/import is an explicit operator step. Never infer a
      // historical destination from the currently configured Worker.
      let cursor;
      let events = 0;
      let imported = 0;
      let proofs = 0;
      while (true) {
        const batch = await tx.traceEvent.findMany({
          orderBy: { id: 'asc' },
          take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            ledgerRoute: EVENT_LEDGER_ROUTE_INCLUDE,
            blockchainProof: true,
            legacyRouteRequirement: true,
          },
        });
        if (!batch.length) break;
        for (const event of batch) {
          assert(verifiedEventRoute(event));
          if (event.legacyRouteRequirement) {
            assert(event.ledgerRoute.importDigest);
            assert.equal(event.legacyRouteRequirement.dataHash, event.dataHash);
          } else assert.equal(event.ledgerRoute.importDigest, null);
          if (event.ledgerRoute.importDigest) imported++;
          if (event.blockchainProof) {
            assert(routeProofMatches(event, event.blockchainProof));
            proofs++;
          }
        }
        events += batch.length;
        assert(events <= 10000);
        cursor = batch.at(-1).id;
      }
      const sealed = await tx.ledgerRouteLegacyRequirement.count();
      const mapped = await tx.eventLedgerRoute.count({
        where: { importDigest: { not: null } },
      });
      assert.equal(sealed, mapped);
      return { events, imported, proofs, sealedLegacyEvents: sealed };
    },
    { isolationLevel: 'RepeatableRead', timeout: 120000 },
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      sourceSha: process.env.APP_RELEASE_SHA,
      readOnly: true,
      signingMaterialRead: false,
      ...result,
    }),
  );
} catch {
  console.error(
    'Hybrid history/active-route readiness failed; private payloads and credentials withheld',
  );
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
