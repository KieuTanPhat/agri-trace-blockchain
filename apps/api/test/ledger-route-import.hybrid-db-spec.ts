import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { canonicalSha256 } from '../src/common/crypto/rfc8785.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { BlockchainWorkerService } from '../src/modules/blockchain-adapter/blockchain-worker.service.js';
import { FabricAdapterProvider } from '../src/modules/blockchain-adapter/fabric-adapter.provider.js';
import { fixtureRoute } from './support/ledger-route-fixture.js';
import {
  ledgerRouteDigest,
  type PinnedRoute,
} from '../src/modules/trace/ledger-route.js';
import {
  applyLedgerRouteImport,
  inventoryLedgerRoutes,
  registerLedgerRouteDefinition,
} from '../src/modules/trace/ledger-route-import.js';
import {
  ROUTE_IMPORT_PROTOCOL,
  WRITER_SNAPSHOT_PROTOCOL,
  type RouteImportArtifact,
} from '../src/modules/trace/ledger-route-import-artifact.js';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const context = { environment: 'isolated' as const, sourceSha: 'a'.repeat(40) };
const historicalPayload = {
  ...fixtureRoute,
  mode: 'HISTORICAL',
  envelopeVersion: null,
  writerAuthority: null,
  writerMspId: null,
  writerRole: null,
};
const historical: PinnedRoute = {
  ...historicalPayload,
  digest: ledgerRouteDigest(historicalPayload),
};
const pendingPayload = {
  ...fixtureRoute,
  writerAuthority: 'isolated:legacy-import-relayer',
};
const pendingRoute = {
  ...pendingPayload,
  digest: ledgerRouteDigest(pendingPayload),
};
const trace = new TraceService(
  db as unknown as PrismaService,
  {
    assertTraceEventAccess: vi.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationAccessService,
);

beforeAll(async () => {
  expect(await db.ledgerRouteLegacyRequirement.count()).toBeGreaterThanOrEqual(
    22,
  );
  process.env.LEDGER_ROUTE_IMPORT_ENABLED = 'true';
  process.env.LEDGER_ROUTE_PINS = JSON.stringify([
    fixtureRoute.digest,
    historical.digest,
    pendingRoute.digest,
  ]);
  await registerLedgerRouteDefinition(db, historical, context);
  await registerLedgerRouteDefinition(db, pendingRoute, context);
});
beforeEach(() => {
  process.env.LEDGER_ROUTE_IMPORT_ENABLED = 'true';
  process.env.LEDGER_ROUTE_PINS = JSON.stringify([
    fixtureRoute.digest,
    historical.digest,
    pendingRoute.digest,
  ]);
  process.env.LEDGER_ACTIVE_ROUTE_DIGEST = fixtureRoute.digest;
  process.env.LEDGER_ROUTE_IMPORT_PINS = '[]';
  process.env.LEDGER_PAUSED_WRITER_PINS = '[]';
});
afterAll(() => db.$disconnect());

function pin(artifact: RouteImportArtifact) {
  const digest = canonicalSha256(artifact);
  const pins = JSON.parse(
    process.env.LEDGER_ROUTE_IMPORT_PINS ?? '[]',
  ) as unknown[];
  process.env.LEDGER_ROUTE_IMPORT_PINS = JSON.stringify([
    ...pins,
    {
      digest,
      sourceSha: artifact.sourceSha,
      environment: artifact.environment,
    },
  ]);
  return digest;
}
async function prepared(scenario: string, pending = false, onlyLast = false) {
  const cycle = await db.productionCycle.findFirstOrThrow({
    where: { cycleCode: `legacy-route-${scenario}` },
  });
  const events = await db.traceEvent.findMany({
    where: { cycleId: cycle.id, legacyRouteRequirement: { isNot: null } },
    orderBy: { eventTime: 'asc' },
  });
  expect(events).toHaveLength(2);
  const ids = (onlyLast ? events.slice(-1) : events).map((event) => event.id);
  const inventory = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return inventoryLedgerRoutes(tx, ids);
    },
    { isolationLevel: 'RepeatableRead' },
  );
  const route = pending ? pendingRoute : historical;
  const descriptor = {
    protocol: WRITER_SNAPSHOT_PROTOCOL,
    environment: context.environment,
    releaseSha: 'b'.repeat(40),
    definitionDigest: route.digest,
    paused: true,
  } as const;
  const descriptorDigest = canonicalSha256(descriptor);
  if (pending)
    process.env.LEDGER_PAUSED_WRITER_PINS = JSON.stringify([descriptorDigest]);
  const artifact: RouteImportArtifact = {
    protocol: ROUTE_IMPORT_PROTOCOL,
    id: randomUUID(),
    ...context,
    inventoryDigest: inventory.digest,
    reviewEvidenceDigest: 'c'.repeat(64),
    entries: inventory.entries.map((row) => ({
      eventId: row.eventId,
      dataHash: row.dataHash,
      eventRowDigest: row.eventRowDigest,
      snapshotDigest: row.snapshotDigest,
      definitionDigest: route.digest,
      evidence: pending
        ? { kind: 'PAUSED_WRITER', digest: descriptorDigest, descriptor }
        : { kind: 'PROOF', digest: row.proofDigest! },
    })),
  };
  return { artifact, events, cycle, inventory, descriptorDigest };
}
async function preserved(ids: string[]) {
  return db.$queryRaw(Prisma.sql`
    SELECT e.event_id,to_jsonb(e)::text AS event,to_jsonb(p)::text AS proof,to_jsonb(o)::text AS outbox
    FROM trace_event e LEFT JOIN blockchain_proof p USING(event_id) LEFT JOIN blockchain_outbox o USING(event_id)
    WHERE e.event_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY e.event_id
  `);
}

describe('Controlled legacy route imports on PostgreSQL 18', () => {
  it('imports confirmed historical proofs in predecessor order and reruns without modifying exact rows', async () => {
    const f = await prepared('proof');
    // Deliberately reverse the batch; topological apply must not depend on JSON order.
    f.artifact.entries.reverse();
    const digest = pin(f.artifact),
      ids = f.events.map((event) => event.id);
    const before = await preserved(ids);
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).resolves.toMatchObject({ digest, imported: 2, alreadyApplied: 0 });
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).resolves.toMatchObject({ digest, imported: 0, alreadyApplied: 2 });
    expect(await preserved(ids)).toEqual(before);
    expect(
      await db.eventLedgerRoute.findMany({ where: { eventId: { in: ids } } }),
    ).toHaveLength(2);
    for (const event of f.events)
      expect(
        await trace.getProof(event.id, {
          sub: null,
          organizationId: null,
          role: 'SYSTEM_ACTOR',
        }),
      ).toMatchObject({
        proofStatus: 'VERIFIED',
        network: historical.network,
        channelId: historical.channelId,
      });
  });
  it('binds pending backlog to a separately pinned paused writer and holds it before claim when its import pin is withdrawn', async () => {
    const f = await prepared('pending', true);
    pin(f.artifact);
    await applyLedgerRouteImport(db, f.artifact, context);
    const before = await preserved(f.events.map((event) => event.id));
    process.env.LEDGER_ROUTE_IMPORT_PINS = '[]';
    const adapter = {
      healthCheck: vi
        .fn()
        .mockResolvedValue({ status: 'OK', envelopeVersion: '3.0.0' }),
      submitTraceEvent: vi.fn(),
      getProof: vi.fn(),
    };
    const provider = {
      getWriterRoute: () => pendingRoute,
      getAdapter: vi.fn().mockResolvedValue(adapter),
    };
    const service = new BlockchainWorkerService(
      db as unknown as PrismaService,
      {
        get: (_key: string, fallback: unknown) => fallback,
      } as unknown as ConfigService,
      provider as unknown as FabricAdapterProvider,
    );
    await expect(service.processPending()).resolves.toMatchObject({
      processed: 0,
    });
    expect(adapter.submitTraceEvent).not.toHaveBeenCalled();
    expect(await preserved(f.events.map((event) => event.id))).toEqual(before);
    expect(
      await trace.getProof(f.events[0].id, {
        sub: null,
        organizationId: null,
        role: 'SYSTEM_ACTOR',
      }),
    ).toMatchObject({
      localHashMatches: false,
      network: null,
      channelId: null,
    });
  });
  it.each(['source', 'environment', 'pin'] as const)(
    'rejects an untrusted %s before any mapping',
    async (field) => {
      const f = await prepared('unresolved', true);
      if (field !== 'pin') pin(f.artifact);
      await expect(
        applyLedgerRouteImport(
          db,
          f.artifact,
          field === 'source'
            ? { ...context, sourceSha: 'd'.repeat(40) }
            : field === 'environment'
              ? { ...context, environment: 'production' }
              : context,
        ),
      ).rejects.toThrow();
      expect(
        await db.eventLedgerRoute.count({
          where: { eventId: { in: f.events.map((event) => event.id) } },
        }),
      ).toBe(0);
    },
  );
  it('holds unknown pending protocol when no independent paused-writer descriptor pin exists', async () => {
    const f = await prepared('unresolved', true);
    pin(f.artifact);
    process.env.LEDGER_PAUSED_WRITER_PINS = '[]';
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).rejects.toThrow();
    expect(
      await db.ledgerRouteImport.count({
        where: { digest: canonicalSha256(f.artifact) },
      }),
    ).toBe(0);
  });
  it('rejects a changed outbox snapshot without partial provenance', async () => {
    const f = await prepared('changed');
    const digest = pin(f.artifact);
    await db.blockchainOutbox.update({
      where: { eventId: f.events[0].id },
      data: { lastError: 'Synthetic change after review' },
    });
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).rejects.toThrow('inventory changed');
    expect(
      await db.ledgerRouteImport.findUnique({ where: { digest } }),
    ).toBeNull();
  });
  it('detects changes below JavaScript millisecond precision in the SQL inventory', async () => {
    const f = await prepared('precision');
    const digest = pin(f.artifact);
    await db.$executeRaw`UPDATE blockchain_outbox SET updated_at=updated_at+interval '1 microsecond' WHERE event_id=${f.events[0].id}::uuid`;
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).rejects.toThrow('inventory changed');
    expect(
      await db.ledgerRouteImport.findUnique({ where: { digest } }),
    ).toBeNull();
  });
  it('rejects a proof digest mismatch even when the artifact is independently pinned', async () => {
    const f = await prepared('wrong-proof');
    f.artifact.entries[0].evidence = { kind: 'PROOF', digest: '9'.repeat(64) };
    pin(f.artifact);
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).rejects.toThrow('confirmed proof differs');
  });
  it('keeps old applied provenance immutable instead of replacing it with another artifact', async () => {
    const f = await prepared('conflict');
    const oldDigest = pin(f.artifact);
    await applyLedgerRouteImport(db, f.artifact, context);
    const replacement = {
      ...f.artifact,
      id: randomUUID(),
      reviewEvidenceDigest: 'd'.repeat(64),
    };
    pin(replacement);
    await expect(
      applyLedgerRouteImport(db, replacement, context),
    ).rejects.toThrow('replace applied provenance');
    expect(
      await db.eventLedgerRoute.findUnique({
        where: { eventId: f.events[0].id },
      }),
    ).toMatchObject({ importDigest: oldDigest });
    await expect(
      db.ledgerRouteImport.update({
        where: { digest: oldDigest },
        data: { sourceSha: 'e'.repeat(40) },
      }),
    ).rejects.toThrow();
    await expect(
      db.ledgerRouteImport.delete({ where: { digest: oldDigest } }),
    ).rejects.toThrow();
  });
  it('rolls back the registry and all mappings when an external predecessor is unresolved', async () => {
    const f = await prepared('rollback', false, true);
    const digest = pin(f.artifact);
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).rejects.toThrow('predecessor destination/provenance');
    expect(
      await db.ledgerRouteImport.findUnique({ where: { digest } }),
    ).toBeNull();
    expect(
      await db.eventLedgerRoute.count({
        where: { eventId: { in: f.events.map((event) => event.id) } },
      }),
    ).toBe(0);
  });
  it('holds even expired PROCESSING leases without changing the key, lease or retry budget', async () => {
    const f = await prepared('lease', true);
    pin(f.artifact);
    const lease = await db.blockchainOutbox.update({
      where: { eventId: f.events[0].id },
      data: {
        status: 'PROCESSING',
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(0),
      },
    });
    try {
      await expect(
        applyLedgerRouteImport(db, f.artifact, context),
      ).rejects.toThrow('PROCESSING leases');
      expect(
        await db.blockchainOutbox.findUnique({
          where: { eventId: f.events[0].id },
        }),
      ).toEqual(lease);
    } finally {
      await db.blockchainOutbox.update({
        where: { eventId: f.events[0].id },
        data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null },
      });
    }
  });
  it('resumes separate pinned batches while retaining the first batch and all old history', async () => {
    const a = await prepared('resume-a'),
      b = await prepared('resume-b');
    const digestA = pin(a.artifact),
      digestB = pin(b.artifact);
    await applyLedgerRouteImport(db, a.artifact, context);
    await applyLedgerRouteImport(db, b.artifact, context);
    await expect(
      applyLedgerRouteImport(db, a.artifact, context),
    ).resolves.toMatchObject({ alreadyApplied: 2, imported: 0 });
    expect(
      await db.ledgerRouteImport.count({
        where: { digest: { in: [digestA, digestB] } },
      }),
    ).toBe(2);
  });
  it('rejects direct legacy mapping without provenance and seals the requirement inventory', async () => {
    const f = await prepared('unresolved', true);
    await expect(
      db.eventLedgerRoute.create({
        data: {
          eventId: f.events[0].id,
          definitionDigest: fixtureRoute.digest,
        },
      }),
    ).rejects.toThrow('requires matching import provenance');
    await expect(
      db.ledgerRouteLegacyRequirement.update({
        where: { eventId: f.events[0].id },
        data: { dataHash: 'f'.repeat(64) },
      }),
    ).rejects.toThrow('inventory is sealed');
    await expect(
      db.ledgerRouteLegacyRequirement.delete({
        where: { eventId: f.events[0].id },
      }),
    ).rejects.toThrow('inventory is sealed');
    const event = await db.$transaction((tx) =>
      trace.createInTransaction(tx, {
        entityType: 'CARE_RECORD',
        entityId: randomUUID(),
        cycleId: f.cycle.id,
        eventType: 'NEW_ROUTE_REHEARSAL',
        actor: { sub: null, organizationId: null, role: 'SYSTEM_ACTOR' },
        businessData: { synthetic: true },
      }),
    );
    await expect(
      db.ledgerRouteLegacyRequirement.create({
        data: { eventId: event.id, dataHash: event.dataHash },
      }),
    ).rejects.toThrow('inventory is sealed');
    await expect(
      db.$transaction((tx) => inventoryLedgerRoutes(tx, [event.id])),
    ).rejects.toThrow('non-legacy event');
  });
  it('keeps the operator gate closed by default even with pinned metadata', async () => {
    const f = await prepared('unresolved', true);
    pin(f.artifact);
    delete process.env.LEDGER_ROUTE_IMPORT_ENABLED;
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).rejects.toThrow('operator gate is closed');
  });

  it('serializes concurrent apply of the same artifact into one atomic batch', async () => {
    const f = await prepared('concurrent');
    const digest = pin(f.artifact);
    const outcomes = await Promise.all([
      applyLedgerRouteImport(db, f.artifact, context),
      applyLedgerRouteImport(db, f.artifact, context),
    ]);
    expect(outcomes.map((result) => result.imported).sort()).toEqual([0, 2]);
    expect(await db.ledgerRouteImport.count({ where: { digest } })).toBe(1);
    expect(
      await db.eventLedgerRoute.count({ where: { importDigest: digest } }),
    ).toBe(2);
  });

  it('rolls back an earlier sidecar when a later entry crosses the predecessor destination', async () => {
    const f = await prepared('atomic');
    const payload = {
      ...historical,
      chaincodeName: 'another-reviewed-chaincode',
    };
    const moved = { ...payload, digest: ledgerRouteDigest(payload) };
    process.env.LEDGER_ROUTE_PINS = JSON.stringify([
      fixtureRoute.digest,
      historical.digest,
      moved.digest,
    ]);
    await registerLedgerRouteDefinition(db, moved, context);
    f.artifact.entries.find(
      (entry) => entry.eventId === f.events[1].id,
    )!.definitionDigest = moved.digest;
    const digest = pin(f.artifact);
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).rejects.toThrow('predecessor destination/provenance');
    expect(
      await db.ledgerRouteImport.findUnique({ where: { digest } }),
    ).toBeNull();
    expect(
      await db.eventLedgerRoute.count({
        where: { eventId: { in: f.events.map((event) => event.id) } },
      }),
    ).toBe(0);
  });

  it('claims a trusted imported backlog in order and keeps rerun idempotent after proof/outbox progress', async () => {
    const f = await prepared('pending-relay', true);
    pin(f.artifact);
    await applyLedgerRouteImport(db, f.artifact, context);
    const before = await db.traceEvent.findMany({
      where: { cycleId: f.cycle.id },
      orderBy: { id: 'asc' },
    });
    const adapter = {
      healthCheck: vi
        .fn()
        .mockResolvedValue({ status: 'OK', envelopeVersion: '3.0.0' }),
      submitTraceEvent: vi.fn(async (input: Record<string, unknown>) => ({
        ...input,
        txId: canonicalSha256({ fixture: 'route-import', id: input.eventId }),
      })),
      getProof: vi.fn(async (id: string) => {
        const event = await db.traceEvent.findUniqueOrThrow({ where: { id } });
        return {
          envelopeVersion: '3.0.0',
          nonce: id,
          eventId: id,
          entityType: event.entityType,
          entityId: event.entityId,
          cycleId: event.cycleId,
          lotId: event.lotId,
          eventType: event.eventType,
          eventTime: event.eventTime.toISOString(),
          dataHash: event.dataHash,
          previousEventHash: event.previousEventHash,
          schemaVersion: event.schemaVersion,
          canonicalizationVersion: event.canonicalizationVersion,
          channelId: pendingRoute.channelId,
          txId: canonicalSha256({ fixture: 'route-import', id }),
          recordedAt: '2026-10-13T00:00:00.000Z',
        };
      }),
    };
    const service = new BlockchainWorkerService(
      db as unknown as PrismaService,
      {
        get: (_key: string, fallback: unknown) => fallback,
      } as unknown as ConfigService,
      {
        getWriterRoute: () => pendingRoute,
        getAdapter: vi.fn().mockResolvedValue(adapter),
      } as unknown as FabricAdapterProvider,
    );
    await expect(service.processPending()).resolves.toMatchObject({
      processed: 1,
    });
    await expect(service.processPending()).resolves.toMatchObject({
      processed: 1,
    });
    expect(adapter.submitTraceEvent).toHaveBeenCalledTimes(2);
    expect(
      await db.blockchainProof.count({
        where: {
          eventId: { in: f.events.map((event) => event.id) },
          transactionStatus: 'CONFIRMED',
        },
      }),
    ).toBe(2);
    await expect(
      applyLedgerRouteImport(db, f.artifact, context),
    ).resolves.toMatchObject({ imported: 0, alreadyApplied: 2 });
    expect(
      await db.traceEvent.findMany({
        where: { cycleId: f.cycle.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });
});
