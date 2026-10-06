import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BlockchainWorkerService } from './blockchain-worker.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { ForbiddenException } from '@nestjs/common';
import { calculateTraceEventHash } from '../trace/trace-hash.js';


describe('BlockchainWorkerService distributed claim', () => {
  it('claims due proofs under a PostgreSQL SKIP LOCKED transaction', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: queryRaw }),
    );
    const service = new BlockchainWorkerService({
      $transaction: transaction,
    } as unknown as PrismaService,
    {} as OrganizationAccessService,);

    await expect(service.processPending(7)).resolves.toEqual({
      processed: 0,
      skipped: false,
    });

    expect(transaction).toHaveBeenCalledOnce();
    const sql = queryRaw.mock.calls[0][0] as { strings: readonly string[] };
    expect(sql.strings.join(' ')).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql.strings.join(' ')).toContain('next_attempt_at');
    expect(sql.strings.join(' ')).toContain('previous_event_hash');
    expect(sql.strings.join(' ')).toContain(
      'previous_proof.transaction_status',
    );
  });
});

describe('BlockchainWokerService verification access', () => {
  const eventId = 'b9038f8a-5a42-49fc-aa62-93225c5b7994';
  const lotId = 'a6d7dacc-da9a-45b9-b144-5563ae822715';

  const actor = {
    sub: '34695828-dd6f-4463-8607-a9758a2967d6',
    organizationId: '5f664af2-3522-4f18-bebb-38aa135bbcad',
    role: 'FARM_STAFF',
  };

  const event = {
    id: eventId,
    entityType: 'SHIPMENT',
    entityId: 'e7d04782-a1b5-4a39-b590-e6769e836fb9',
    cycleId: null,
    lotId,
    eventType: 'SHIPMENT_CREATED',
    eventTime: new Date('2026-09-21T00:00:00.000Z'),
    actorUserId: actor.sub,
    actorOrganizationId: actor.organizationId,
    actorRole: actor.role,
    authProofType: 'TOKEN_FINGERPRINT',
    actorAuthProof: 'a'.repeat(64),
    businessData: { quantity: '100' },
    previousEventHash: null,
    schemaVersion: '2.0.0',
    canonicalizationVersion: 'RFC8785',
  };

  it('rejects verification before returning data to an unauthorized organization', async () => {
    const prisma = {
      blockchainProof: {
        findUnique: vi.fn().mockResolvedValue({
          eventId,
          transactionStatus: 'PENDING',
          dataHash: calculateTraceEventHash(event),
          traceEvent: event,
        }),
      },
    };

    const access = {
      assertLotAccess: vi
        .fn()
        .mockRejectedValue(new ForbiddenException('Không có quyền xem lô')),
    };

    const service = new BlockchainWorkerService(
      prisma as unknown as PrismaService,
      access as unknown as OrganizationAccessService,
    );

    await expect(service.verify(eventId, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(access.assertLotAccess).toHaveBeenCalledWith(actor, lotId);
  });

  it('returns verification status after access is granted', async () => {
    const dataHash = calculateTraceEventHash(event);
    const traceEvent = {
      ...event,
      dataHash,
    };

    const prisma = {
      blockchainProof: {
        findUnique: vi.fn().mockResolvedValue({
          eventId,
          transactionStatus: 'PENDING',
          dataHash,
          txId: null,
          channelId: 'agritrace',
          traceEvent,
        }),
      },
    };

    const access = {
      assertLotAccess: vi.fn().mockResolvedValue({ id: lotId }),
    };

    const service = new BlockchainWorkerService(
      prisma as unknown as PrismaService,
      access as unknown as OrganizationAccessService,
    );

    await expect(service.verify(eventId, actor)).resolves.toEqual(
      expect.objectContaining({
        eventId,
        status: 'PENDING',
        localHashMatches: true,
      }),
    );

    expect(access.assertLotAccess).toHaveBeenCalledWith(actor, lotId);
  });
})
