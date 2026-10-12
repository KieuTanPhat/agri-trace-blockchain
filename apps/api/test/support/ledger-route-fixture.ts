import type { Prisma } from '../../src/generated/prisma/client.js';
import {
  ledgerRouteDigest,
  ROUTE_PROTOCOL,
  type RouteDefinition,
} from '../../src/modules/trace/ledger-route.js';

/** Synthetic metadata only. These definitions/proofs are never Fabric acceptance. */
export const fixtureRoutePayload: RouteDefinition = {
  protocol: ROUTE_PROTOCOL,
  mode: 'WRITE',
  network: 'audit-fixture',
  channelId: 'agritrace',
  chaincodeName: 'agritrace',
  contractName: 'AgriTraceContract',
  envelopeVersion: '3.0.0',
  writerAuthority: 'isolated:technical-relayer',
  writerMspId: 'FixtureMSP',
  writerRole: 'relayer',
};
export const fixtureRoute = {
  ...fixtureRoutePayload,
  digest: ledgerRouteDigest(fixtureRoutePayload),
};
export function fixtureRoutePins() {
  process.env.LEDGER_ROUTE_PINS = JSON.stringify([fixtureRoute.digest]);
  process.env.LEDGER_ACTIVE_ROUTE_DIGEST = fixtureRoute.digest;
}
export async function registerFixtureRoute(db: Prisma.TransactionClient) {
  if (process.env.NODE_ENV !== 'test' || !process.env.TEST_DATABASE_URL)
    throw new Error(
      'Ledger fixture requires an explicit isolated test database',
    );
  fixtureRoutePins();
  await db.ledgerRouteDefinition.createMany({
    data: [fixtureRoute],
    skipDuplicates: true,
  });
}
