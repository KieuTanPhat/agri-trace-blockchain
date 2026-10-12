import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { calculateTraceEventHash } from '../src/modules/trace/trace-hash.ts';
import { fixtureRoutePayload } from '../test/support/ledger-route-fixture.ts';

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.HYBRID_DRAFT_TESTS !== '1' ||
  !/@127\.0\.0\.1:25488\/scope_test$/.test(process.env.TEST_DATABASE_URL ?? '')
)
  throw new Error(
    'Legacy route seed requires an explicit isolated test database',
  );
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
try {
  if (
    (
      await db.$queryRaw`SELECT to_regclass('public.ledger_route_legacy_requirement')::text AS sealed`
    )[0].sealed
  )
    throw new Error(
      'Legacy route seed must run before route guards, never disable them',
    );
  await db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: { name: 'Synthetic legacy route rehearsal', type: 'FARM' },
      });
      const chain = await tx.supplyChain.create({
        data: { name: randomUUID(), ownerOrganizationId: org.id },
      });
      await tx.chainMembership.create({
        data: { chainId: chain.id, organizationId: org.id, status: 'ACTIVE' },
      });
      await tx.chainBusinessProfile.create({ data: { chainId: chain.id } });
      await tx.chainBusinessProfile.update({
        where: { chainId: chain.id },
        data: { state: 'ACTIVE', version: 1 },
      });
      const farm = await tx.farm.create({
        data: { name: 'Synthetic legacy route farm', organizationId: org.id },
      });
      const product = await tx.product.create({
        data: { productName: randomUUID() },
      });
      for (const scenario of [
        'proof',
        'pending',
        'unresolved',
        'changed',
        'wrong-proof',
        'conflict',
        'rollback',
        'lease',
        'resume-a',
        'resume-b',
        'precision',
        'pending-relay',
        'concurrent',
        'atomic',
      ]) {
        const cycle = await tx.productionCycle.create({
          data: {
            cycleCode: `legacy-route-${scenario}`,
            chainId: chain.id,
            farmOrgId: org.id,
            farmId: farm.id,
            productId: product.id,
          },
        });
        let previousEventHash = null;
        for (let i = 0; i < 2; i++) {
          const payload = {
            id: randomUUID(),
            entityType: 'PRODUCTION_CYCLE',
            entityId: cycle.id,
            cycleId: cycle.id,
            lotId: null,
            eventType: 'LEGACY_ROUTE_REHEARSAL',
            eventTime: new Date(`2026-10-01T00:00:0${i}.000Z`),
            actorUserId: null,
            actorOrganizationId: null,
            actorRole: 'SYSTEM_ACTOR',
            authProofType: 'SYSTEM_ASSERTION',
            actorAuthProof: 'a'.repeat(64),
            businessData: { synthetic: true, scenario, sequence: i },
            previousEventHash,
            schemaVersion: '2.0.0',
            canonicalizationVersion: 'RFC8785',
          };
          const dataHash = calculateTraceEventHash(payload);
          await tx.traceEvent.create({ data: { ...payload, dataHash } });
          const pending = [
            'pending',
            'unresolved',
            'lease',
            'pending-relay',
          ].includes(scenario);
          await tx.blockchainOutbox.create({
            data: {
              eventId: payload.id,
              status: pending ? 'PENDING' : 'COMPLETED',
              attemptCount: pending ? 0 : 1,
              completedAt: pending ? null : payload.eventTime,
              nextAttemptAt: pending ? payload.eventTime : null,
            },
          });
          if (!pending)
            await tx.blockchainProof.create({
              data: {
                eventId: payload.id,
                dataHash,
                network: fixtureRoutePayload.network,
                channelId: fixtureRoutePayload.channelId,
                transactionStatus: 'CONFIRMED',
                txId: (i.toString() + payload.id.replaceAll('-', '')).padEnd(
                  64,
                  '0',
                ),
                recordedAt: payload.eventTime,
              },
            });
          previousEventHash = dataHash;
        }
      }
    },
    { timeout: 60000 },
  );
  console.log(
    JSON.stringify({
      synthetic: true,
      scenarios: 14,
      events: 28,
      guardsDisabled: false,
    }),
  );
} finally {
  await db.$disconnect();
}
