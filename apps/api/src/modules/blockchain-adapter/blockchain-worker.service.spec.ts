import { vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { BlockchainAdapterFactory } from '../../common/ports/blockchain.port.js';
import { BlockchainWorkerService } from './blockchain-worker.service.js';

describe('BlockchainWorkerService distributed claim', () => {
  it('claims due proofs under a PostgreSQL SKIP LOCKED transaction', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: queryRaw }),
    );
    const service = new BlockchainWorkerService(
      {
        $transaction: transaction,
      } as unknown as PrismaService,
      {
        get: vi.fn((_name: string, fallback: unknown) => fallback),
      } as unknown as ConfigService,
      {} as BlockchainAdapterFactory,
    );

    await expect(service.processPending(7)).resolves.toEqual({
      processed: 0,
      skipped: false,
    });

    expect(transaction).toHaveBeenCalledOnce();
    const sql = queryRaw.mock.calls[0][0] as { strings: readonly string[] };
    expect(sql.strings.join(' ')).toContain('FOR UPDATE OF bo SKIP LOCKED');
    expect(sql.strings.join(' ')).toContain('blockchain_outbox');
    expect(sql.strings.join(' ')).toContain('lease_expires_at');
    expect(sql.strings.join(' ')).toContain('previous_event_hash');
    expect(sql.strings.join(' ')).toContain('previous_outbox.status');
  });

  it('completes the leased outbox row and creates a confirmed proof atomically', async () => {
    const job = claimedJob(1);
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const upsert = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: job.id }]),
      blockchainOutbox: {
        updateMany,
        findMany: vi.fn().mockResolvedValue([job]),
      },
      blockchainProof: { upsert },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const adapter = {
      submitTraceEvent: vi.fn().mockResolvedValue({
        txId: 'fabric-tx-1',
        recordedAt: '2026-09-21T00:00:00.000Z',
        channelId: 'agritrace',
        dataHash: job.traceEvent.dataHash,
      }),
    };
    const service = new BlockchainWorkerService(
      prisma as unknown as PrismaService,
      configService(),
      {
        getAdapter: vi.fn().mockResolvedValue(adapter),
      } as unknown as BlockchainAdapterFactory,
    );

    await expect(service.processPending()).resolves.toEqual({
      processed: 1,
      skipped: false,
    });

    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: job.id,
          status: 'PROCESSING',
          leaseToken: job.leaseToken,
        }),
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eventId: job.eventId,
          transactionStatus: 'CONFIRMED',
          txId: 'fabric-tx-1',
        }),
      }),
    );
  });

  it('moves an exhausted delivery to dead-letter', async () => {
    const job = claimedJob(5);
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: job.id }]),
      blockchainOutbox: {
        updateMany,
        findMany: vi.fn().mockResolvedValue([job]),
      },
      blockchainProof: { upsert: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
      blockchainOutbox: { updateMany },
    };
    const service = new BlockchainWorkerService(
      prisma as unknown as PrismaService,
      configService(),
      {
        getAdapter: vi.fn().mockResolvedValue({
          submitTraceEvent: vi
            .fn()
            .mockRejectedValue(new Error('peer offline')),
        }),
      } as unknown as BlockchainAdapterFactory,
    );

    await service.processPending();

    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DEAD_LETTER',
          nextAttemptAt: null,
          lastError: 'peer offline',
        }),
      }),
    );
  });

  it.each([
    { txId: 'tx', dataHash: 'b'.repeat(64) },
    { txId: 'tx', dataHash: 'a'.repeat(64), recordedAt: 'invalid' },
  ])('never confirms an invalid receipt: %j', async (receipt) => {
    const { service, updateMany, upsert } = workerWithReceipt(receipt);
    await service.processPending();
    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DEAD_LETTER' }),
      }),
    );
  });

  it('recovers a committed duplicate by querying the existing proof', async () => {
    const { service, upsert, adapter } = workerWithReceipt({
      txId: 'original-tx',
      dataHash: 'a'.repeat(64),
    });
    adapter.submitTraceEvent.mockRejectedValue(
      new Error('DUPLICATE_EVENT: already exists'),
    );
    await service.processPending();
    expect(adapter.getProof).toHaveBeenCalledWith(claimedJob(1).eventId);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          txId: 'original-tx',
          transactionStatus: 'CONFIRMED',
        }),
      }),
    );
  });

  it('dead-letters contract failures without retrying', async () => {
    const { service, updateMany, adapter } = workerWithReceipt({});
    adapter.submitTraceEvent.mockRejectedValue(
      new Error('INVALID_INPUT: invalid payload'),
    );
    await service.processPending();
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DEAD_LETTER',
          nextAttemptAt: null,
        }),
      }),
    );
  });

  it('ignores completion from a worker whose lease was reclaimed', async () => {
    const { service, updateMany, upsert } = workerWithReceipt({
      txId: 'tx',
      dataHash: 'a'.repeat(64),
    });
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await service.processPending();
    expect(upsert).not.toHaveBeenCalled();
  });
});

function workerWithReceipt(receipt: object) {
  const job = claimedJob(1);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const upsert = vi.fn();
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: job.id }]),
    blockchainOutbox: {
      updateMany,
      findMany: vi.fn().mockResolvedValue([job]),
    },
    blockchainProof: { upsert },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
    blockchainOutbox: { updateMany },
  };
  const adapter = {
    submitTraceEvent: vi.fn().mockResolvedValue(receipt),
    getProof: vi.fn().mockResolvedValue(receipt),
  };
  const service = new BlockchainWorkerService(
    prisma as unknown as PrismaService,
    configService(),
    {
      getAdapter: vi.fn().mockResolvedValue(adapter),
    } as unknown as BlockchainAdapterFactory,
  );
  return { service, updateMany, upsert, adapter };
}

function configService(): ConfigService {
  return {
    get: vi.fn((name: string, fallback: unknown) =>
      name === 'FABRIC_MAX_RETRIES' ? 5 : fallback,
    ),
  } as unknown as ConfigService;
}

function claimedJob(attemptCount: number) {
  return {
    id: 'b0f09ea4-2675-49e9-bccc-f09aaee66548',
    eventId: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
    status: 'PROCESSING',
    attemptCount,
    nextAttemptAt: null,
    leaseToken: '1934da4e-5226-4383-85f4-4e51a2670981',
    leaseExpiresAt: new Date('2026-09-21T00:02:00.000Z'),
    lastError: null,
    completedAt: null,
    createdAt: new Date('2026-09-21T00:00:00.000Z'),
    updatedAt: new Date('2026-09-21T00:00:00.000Z'),
    traceEvent: {
      id: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
      entityType: 'LOT',
      entityId: '631e9648-174d-48a0-9494-353bda8775da',
      cycleId: null,
      lotId: '631e9648-174d-48a0-9494-353bda8775da',
      eventType: 'HARVEST_RECORDED',
      actorUserId: null,
      actorOrganizationId: null,
      actorRole: 'SYSTEM',
      authProofType: 'SYSTEM_ASSERTION',
      actorAuthProof: 'proof',
      eventTime: new Date('2026-09-21T00:00:00.000Z'),
      serverRecordedAt: new Date('2026-09-21T00:00:00.000Z'),
      businessData: {},
      schemaVersion: '2.0.0',
      canonicalizationVersion: 'RFC8785',
      dataHash: 'a'.repeat(64),
      previousEventHash: null,
      supersedesEventId: null,
      causationEventId: null,
      createdAt: new Date('2026-09-21T00:00:00.000Z'),
    },
  };
}
