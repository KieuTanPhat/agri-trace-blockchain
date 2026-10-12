import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { BlockchainWorkerService } from '../src/modules/blockchain-adapter/blockchain-worker.service.js';
import { FabricAdapterProvider } from '../src/modules/blockchain-adapter/fabric-adapter.provider.js';
import {
  ledgerRouteDigest,
  type RouteDefinition,
} from '../src/modules/trace/ledger-route.js';
import { fixtureRoutePayload } from './support/ledger-route-fixture.js';
import { canonicalSha256 } from '../src/common/crypto/rfc8785.js';
import { privateTraceEvidenceMatches } from '../src/modules/trace/trace-evidence.js';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const access = {
  assertTraceEventAccess: vi.fn().mockResolvedValue(undefined),
} as unknown as OrganizationAccessService;
const trace = new TraceService(db as unknown as PrismaService, access);
let rootFixture: {
  chainId: string;
  farmOrgId: string;
  farmId: string;
  productId: string;
};

beforeAll(async () => {
  rootFixture = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: `Route rehearsal ${randomUUID()}`, type: 'FARM' },
    });
    const chain = await tx.supplyChain.create({
      data: { name: randomUUID(), ownerOrganizationId: organization.id },
    });
    await tx.chainMembership.create({
      data: {
        chainId: chain.id,
        organizationId: organization.id,
        status: 'ACTIVE',
      },
    });
    await tx.chainBusinessProfile.create({ data: { chainId: chain.id } });
    await tx.chainBusinessProfile.update({
      where: { chainId: chain.id },
      data: { state: 'ACTIVE', version: 1 },
    });
    const farm = await tx.farm.create({
      data: { organizationId: organization.id, name: 'Synthetic route farm' },
    });
    const product = await tx.product.create({
      data: { productName: randomUUID(), defaultUnit: 'kg' },
    });
    return {
      chainId: chain.id,
      farmOrgId: organization.id,
      farmId: farm.id,
      productId: product.id,
    };
  });
});

afterAll(() => db.$disconnect());

async function register(
  delta: Partial<RouteDefinition> = {},
  forgeDigest = false,
) {
  const payload = {
    ...fixtureRoutePayload,
    writerAuthority: `isolated:${randomUUID()}`,
    ...delta,
  };
  const route = {
    ...payload,
    digest: forgeDigest
      ? randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
      : ledgerRouteDigest(payload),
  };
  await db.ledgerRouteDefinition.create({ data: route });
  process.env.LEDGER_ROUTE_PINS = JSON.stringify([route.digest]);
  process.env.LEDGER_ACTIVE_ROUTE_DIGEST = route.digest;
  return route;
}
async function event(entityId = randomUUID()) {
  // Committed relay tests need real roots in their own scoped chain. Orphan
  // synthetic events would correctly block another suite's legacy inventory.
  const result = await db.$transaction(async (tx) => {
    if (!(await tx.productionCycle.findUnique({ where: { id: entityId } })))
      await tx.productionCycle.create({
        data: { id: entityId, cycleCode: randomUUID(), ...rootFixture },
      });
    return trace.createInTransaction(tx, {
      entityType: 'PRODUCTION_CYCLE',
      entityId,
      cycleId: entityId,
      eventType: 'ROUTE_REHEARSAL',
      actor: { sub: null, organizationId: null, role: 'SYSTEM_ACTOR' },
      businessData: { synthetic: true },
    });
  });
  expect(privateTraceEvidenceMatches(result)).toBe(true);
  return result;
}
async function rejected(
  tx: Prisma.TransactionClient,
  work: () => Promise<unknown>,
) {
  await tx.$executeRawUnsafe('SAVEPOINT route_guard');
  try {
    await expect(work()).rejects.toThrow();
  } finally {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT route_guard');
  }
}
function adapterFor() {
  return {
    healthCheck: vi
      .fn()
      .mockResolvedValue({ status: 'OK', envelopeVersion: '3.0.0' }),
    submitTraceEvent: vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      txId: syntheticTx(input.eventId),
    })),
    getProof: vi.fn(async (eventId: string) => {
      const item = await db.traceEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      return {
        envelopeVersion: '3.0.0',
        nonce: item.id,
        eventId: item.id,
        entityType: item.entityType,
        entityId: item.entityId,
        cycleId: item.cycleId,
        lotId: item.lotId,
        eventType: item.eventType,
        eventTime: item.eventTime.toISOString(),
        dataHash: item.dataHash,
        previousEventHash: item.previousEventHash,
        schemaVersion: item.schemaVersion,
        canonicalizationVersion: item.canonicalizationVersion,
        txId: syntheticTx(item.id),
        channelId: 'agritrace',
        recordedAt: '2026-10-13T00:00:00.000Z',
      };
    }),
  };
}
function syntheticTx(eventId: unknown) {
  return canonicalSha256({ source: 'isolated-ledger-route-test', eventId });
}
function worker(route: RouteDefinition, adapter = adapterFor()) {
  // Mock only the external Fabric connection; claim/lease/proof transactions are real PostgreSQL.
  const provider = {
    getWriterRoute: () => route,
    getAdapter: vi.fn().mockResolvedValue(adapter),
  };
  const config = { get: (_name: string, fallback: unknown) => fallback };
  return {
    service: new BlockchainWorkerService(
      db as unknown as PrismaService,
      config as unknown as ConfigService,
      provider as unknown as FabricAdapterProvider,
    ),
    provider,
    adapter,
  };
}

describe('Logical ledger routes on PostgreSQL 18', () => {
  it.each(['envelopeVersion', 'writerAuthority', 'writerRole'] as const)(
    'rejects direct SQL WRITE definitions with null %s',
    async (field) => {
      await expect(
        db.ledgerRouteDefinition.create({
          data: {
            ...fixtureRoutePayload,
            digest:
              randomUUID().replaceAll('-', '') +
              randomUUID().replaceAll('-', ''),
            [field]: null,
          },
        }),
      ).rejects.toThrow(/constraint/i);
    },
  );

  it('records event, immutable route and outbox atomically without a pending proof', async () => {
    const route = await register();
    const item = await event();
    expect(
      await db.eventLedgerRoute.findUnique({ where: { eventId: item.id } }),
    ).toMatchObject({ definitionDigest: route.digest });
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: item.id } }),
    ).toMatchObject({ status: 'PENDING', attemptCount: 0 });
    expect(
      await db.blockchainProof.findUnique({ where: { eventId: item.id } }),
    ).toBeNull();
  });

  it('rejects direct SQL new events without a route at transaction commit', async () => {
    await register();
    await expect(
      db.$transaction(async (tx) => {
        await tx.traceEvent.create({
          data: {
            entityType: 'LOT',
            entityId: randomUUID(),
            eventType: 'ROUTE_ORPHAN',
            actorRole: 'SYSTEM',
            eventTime: new Date(),
            businessData: {},
            dataHash: 'a'.repeat(64),
          },
        });
      }),
    ).rejects.toThrow('requires an immutable ledger route');
  });

  it('rejects direct update/delete of definitions and event routes', async () => {
    const route = await register();
    const item = await event();
    await db.$transaction(async (tx) => {
      await rejected(tx, () =>
        tx.ledgerRouteDefinition.update({
          where: { digest: route.digest },
          data: { channelId: 'forged' },
        }),
      );
      await rejected(tx, () =>
        tx.ledgerRouteDefinition.delete({ where: { digest: route.digest } }),
      );
      await rejected(tx, () =>
        tx.eventLedgerRoute.update({
          where: { eventId: item.id },
          data: { definitionDigest: route.digest },
        }),
      );
      await rejected(tx, () =>
        tx.eventLedgerRoute.delete({ where: { eventId: item.id } }),
      );
    });
  });

  it('keeps a historical proof verified when current env channel/network changes', async () => {
    const route = await register();
    const item = await event();
    await db.blockchainProof.create({
      data: {
        eventId: item.id,
        network: route.network,
        channelId: route.channelId,
        dataHash: item.dataHash,
        txId:
          randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        recordedAt: new Date(),
        transactionStatus: 'CONFIRMED',
      },
    });
    const previous = {
      channel: process.env.FABRIC_CHANNEL_NAME,
      network: process.env.FABRIC_NETWORK_NAME,
    };
    process.env.FABRIC_CHANNEL_NAME = 'different-current-channel';
    process.env.FABRIC_NETWORK_NAME = 'different-current-network';
    try {
      expect(
        await trace.getProof(item.id, {
          sub: null,
          organizationId: null,
          role: 'SYSTEM',
        }),
      ).toMatchObject({
        network: route.network,
        channelId: route.channelId,
        localHashMatches: true,
        proofStatus: 'VERIFIED',
      });
    } finally {
      if (previous.channel === undefined)
        delete process.env.FABRIC_CHANNEL_NAME;
      else process.env.FABRIC_CHANNEL_NAME = previous.channel;
      if (previous.network === undefined)
        delete process.env.FABRIC_NETWORK_NAME;
      else process.env.FABRIC_NETWORK_NAME = previous.network;
    }
  });

  it.each(['network', 'channelId', 'dataHash'] as const)(
    'rejects proof %s differing from the event route',
    async (field) => {
      const route = await register();
      const item = await event();
      await expect(
        db.blockchainProof.create({
          data: {
            eventId: item.id,
            network: route.network,
            channelId: route.channelId,
            dataHash: item.dataHash,
            [field]:
              field === 'dataHash' ? 'b'.repeat(64) : 'wrong-destination',
          },
        }),
      ).rejects.toThrow('differs from immutable route');
    },
  );

  it('holds a different writer destination before claim without spending a retry', async () => {
    const current = await register();
    await register({ channelId: 'another-ledger' });
    const item = await event();
    const { service, provider } = worker(current);
    await expect(service.processPending()).resolves.toEqual({
      processed: 0,
      skipped: false,
    });
    expect(provider.getAdapter).not.toHaveBeenCalled();
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: item.id } }),
    ).toMatchObject({ status: 'PENDING', attemptCount: 0, leaseToken: null });
  });

  it('holds forged database digest content before claim and new event creation', async () => {
    const route = await register({}, true);
    const { service, provider } = worker(route);
    await expect(service.processPending()).resolves.toEqual({
      processed: 0,
      skipped: false,
    });
    expect(provider.getAdapter).not.toHaveBeenCalled();
    await expect(event()).rejects.toThrow('Ledger route');
  });

  it('keeps a writer health mismatch before all leases and retry budgets', async () => {
    const route = await register();
    const item = await event();
    const adapter = adapterFor();
    adapter.healthCheck.mockResolvedValue({
      status: 'OK',
      envelopeVersion: '2.0.0',
    });
    await expect(
      worker(route, adapter).service.processPending(),
    ).rejects.toThrow('incompatible chaincode');
    expect(adapter.submitTraceEvent).not.toHaveBeenCalled();
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: item.id } }),
    ).toMatchObject({ status: 'PENDING', attemptCount: 0 });
  });

  it('rejects continuing an entity stream on another destination and rolls back all writes', async () => {
    await register();
    const entityId = randomUUID();
    await event(entityId);
    await register({ channelId: 'moved-ledger' });
    await expect(event(entityId)).rejects.toThrow('cùng destination');
    expect(await db.traceEvent.count({ where: { entityId } })).toBe(1);
  });

  it('enforces predecessor destination for direct SQL inserts as well', async () => {
    await register();
    const first = await event();
    const moved = await register({ channelId: 'forged-moved-ledger' });
    await expect(
      db.traceEvent.create({
        data: {
          entityType: first.entityType,
          entityId: first.entityId,
          cycleId: first.cycleId,
          eventType: 'ROUTE_REHEARSAL',
          actorRole: 'SYSTEM',
          eventTime: new Date(),
          businessData: {},
          dataHash: 'b'.repeat(64),
          previousEventHash: first.dataHash,
          ledgerRoute: {
            create: { definition: { connect: { digest: moved.digest } } },
          },
        },
      }),
    ).rejects.toThrow('predecessor route');
    expect(
      await db.traceEvent.count({ where: { entityId: first.entityId } }),
    ).toBe(1);
  });

  it('rejects using an unattested historical definition as an active write route', async () => {
    const route = await register({
      mode: 'HISTORICAL',
      envelopeVersion: null,
      writerAuthority: null,
      writerMspId: null,
      writerRole: null,
    });
    await expect(event()).rejects.toThrow('Ledger route');
    const { service, provider } = worker(route);
    await expect(service.processPending()).resolves.toMatchObject({
      processed: 0,
    });
    expect(provider.getAdapter).not.toHaveBeenCalled();
  });

  it('serializes concurrent real DB claims and confirms predecessors before their successors', async () => {
    const route = await register();
    const entityId = randomUUID();
    const first = await event(entityId);
    const second = await event(entityId);
    const firstWorker = worker(route),
      secondWorker = worker(route);
    let entered!: () => void, release!: () => void;
    const enteredSend = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const allowCommit = new Promise<void>((resolve) => {
      release = resolve;
    });
    firstWorker.adapter.submitTraceEvent.mockImplementation(async (input) => {
      entered();
      await allowCommit;
      return { ...input, txId: syntheticTx(input.eventId) };
    });
    const processing = firstWorker.service.processPending();
    const reachedRelay = await Promise.race([
      enteredSend.then(() => true),
      processing.then(() => false),
    ]);
    if (!reachedRelay)
      throw new Error(
        'Worker exited before reaching the controlled relay gate',
      );
    try {
      await expect(
        secondWorker.service.processPending(),
      ).resolves.toMatchObject({ processed: 0 });
    } finally {
      release();
    }
    await expect(processing).resolves.toMatchObject({ processed: 1 });
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: first.id } }),
    ).toMatchObject({ status: 'COMPLETED', attemptCount: 1 });
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: second.id } }),
    ).toMatchObject({ status: 'PENDING', attemptCount: 0 });
    const next = worker(route);
    await expect(next.service.processPending()).resolves.toMatchObject({
      processed: 1,
    });
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: second.id } }),
    ).toMatchObject({ status: 'COMPLETED', attemptCount: 1 });
    expect(
      await db.blockchainProof.count({
        where: {
          eventId: { in: [first.id, second.id] },
          transactionStatus: 'CONFIRMED',
        },
      }),
    ).toBe(2);
  });

  it('recovers a simulated lost Fabric response through the same event route and duplicate proof', async () => {
    const route = await register();
    const item = await event();
    const adapter = adapterFor();
    let simulatedCommits = 0;
    adapter.submitTraceEvent.mockImplementation(async () => {
      if (!simulatedCommits) {
        simulatedCommits++;
        throw new Error('isolated response lost after simulated commit');
      }
      throw new Error('DUPLICATE_EVENT: isolated committed event');
    });
    await worker(route, adapter).service.processPending();
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: item.id } }),
    ).toMatchObject({ status: 'RETRY', attemptCount: 1 });
    await db.blockchainOutbox.update({
      where: { eventId: item.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await worker(route, adapter).service.processPending();
    expect(simulatedCommits).toBe(1);
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: item.id } }),
    ).toMatchObject({ status: 'COMPLETED', attemptCount: 2 });
    expect(
      await db.blockchainProof.findUnique({ where: { eventId: item.id } }),
    ).toMatchObject({
      channelId: route.channelId,
      network: route.network,
      dataHash: item.dataHash,
      transactionStatus: 'CONFIRMED',
    });
  });

  it('never confirms a committed proof returned from another channel', async () => {
    const route = await register();
    const item = await event();
    const adapter = adapterFor();
    const query = adapter.getProof.getMockImplementation()!;
    adapter.getProof.mockImplementation(async (id) => ({
      ...(await query(id)),
      channelId: 'another-channel',
    }));
    await worker(route, adapter).service.processPending();
    expect(
      await db.blockchainProof.findUnique({ where: { eventId: item.id } }),
    ).toBeNull();
    expect(
      await db.blockchainOutbox.findUnique({ where: { eventId: item.id } }),
    ).toMatchObject({ status: 'DEAD_LETTER', attemptCount: 1 });
  });
});
