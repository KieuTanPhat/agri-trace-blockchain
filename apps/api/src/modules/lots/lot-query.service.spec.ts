import { randomUUID, randomBytes } from 'node:crypto';
import { vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { OrganizationAccessService } from '../auth/organization-access.service.js';
import { calculateTraceEventHash } from '../trace/public.js';
import { LotQueryService } from './lot-query.service.js';
import type { PublicLot } from './lot-query.types.js';
import { Prisma } from '../../generated/prisma/client.js';

function publicFixture(cycleCertificates: PublicLot['certificates'] = []) {
  const lotId = randomUUID();
  const cycleId = randomUUID();
  const actorUserId = randomUUID();
  const harvestId = randomUUID();
  const window = {
    id: randomUUID(),
    cycleId,
    harvestId,
    periodStart: new Date('2026-09-24T00:00:00.000Z'),
    periodEnd: new Date('2026-09-25T00:00:00.000Z'),
    includeStart: true,
    status: 'NO_DATA',
    readingCount: 0,
    digestHash: null,
    schemaVersion: 'harvest-sensor-1',
    reconciliationId: null,
    finalizedAt: new Date('2026-09-25T00:00:00.000Z'),
    sealedAt: new Date('2026-09-25T00:00:00.000Z'),
    readings: [],
    harvest: { cycleId, harvestTime: new Date('2026-09-25T00:00:00.000Z') },
  };
  const events = [0, 1].map((sequence) => {
    const input = {
      id: randomUUID(),
      entityType: sequence === 0 ? 'SENSOR_DIGEST' : 'HARVEST',
      entityId: sequence === 0 ? window.id : harvestId,
      lotId,
      cycleId,
      eventType:
        sequence === 0 ? 'SENSOR_DIGEST_FINALIZED' : 'HARVEST_RECORDED',
      eventTime: window.periodEnd,
      actorUserId,
      actorOrganizationId: randomUUID(),
      actorRole: 'FARM_STAFF',
      authProofType: 'TOKEN_FINGERPRINT',
      actorAuthProof: 'a'.repeat(64),
      businessData: {
        quantity: '1',
        ...(sequence === 0
          ? {
              windowId: window.id,
              harvestId,
              periodStart: window.periodStart.toISOString(),
              periodEnd: window.periodEnd.toISOString(),
              includeStart: true,
              status: 'NO_DATA',
              digestHash: null,
              readingCount: 0,
              schemaVersion: 'harvest-sensor-1',
              reconciliationId: null,
            }
          : { sensorWindowId: window.id, sensorEvidenceStatus: 'NO_DATA' }),
      },
      previousEventHash: null,
      schemaVersion: '2.0.0',
      canonicalizationVersion: 'RFC8785',
    };
    const dataHash = calculateTraceEventHash(input);
    return {
      ...input,
      dataHash,
      blockchainProof: {
        dataHash,
        transactionStatus: 'CONFIRMED',
        network: 'audit-fixture',
        eventId: input.id,
        channelId: 'agritrace',
        txId: randomBytes(32).toString('hex'),
        recordedAt: new Date(),
      },
      blockchainOutbox: { status: 'COMPLETED' },
    };
  });
  const database = {
    traceQr: {
      findUnique: vi.fn().mockResolvedValue({
        lot: {
          id: lotId,
          lotCode: 'TEST-LOT',
          product: { productName: 'Test vegetables' },
          initialQuantity: new Prisma.Decimal(1),
          availableQuantity: new Prisma.Decimal(1),
          expiryDate: null,
          unit: 'kg',
          currentState: 'HARVESTED',
          quantityMovements: [
            {
              type: 'HARVEST_IN',
              quantity: new Prisma.Decimal(1),
              unit: 'kg',
              beforeQty: new Prisma.Decimal(0),
              delta: new Prisma.Decimal(1),
              afterQty: new Prisma.Decimal(1),
            },
          ],
          harvest: {
            sensorWindow: window,
            _count: { lateReadings: 0 },
            harvestTime: events[0].eventTime,
            cycle: {
              id: cycleId,
              cycleCode: 'TEST-CYCLE',
              currentState: 'GROWING',
              startDate: events[0].eventTime,
              certificates: cycleCertificates,
              farm: { organizationId: randomUUID(), name: 'Test farm' },
            },
          },
          shipment: null,
          certificates: [],
        },
      }),
    },
    traceEvent: { findMany: vi.fn().mockResolvedValue(events) },
  };
  const service = new LotQueryService(
    database as unknown as PrismaService,
    {} as OrganizationAccessService,
  );
  return { service, events, actorUserId, database };
}

describe('Public lot proof projection', () => {
  it('includes approved public cycle certificates using an explicit field allowlist', async () => {
    const certificate = {
      type: 'VietGAP',
      issuer: 'Test issuer',
      issueDate: new Date('2026-09-01'),
      expiryDate: null,
      documentHash: 'a'.repeat(64),
      status: 'APPROVED',
      documentRef: 'private-reference',
      reviewNote: 'private-review',
    };
    const { service, database } = publicFixture([certificate]);
    const result = await service.getPublic('test-token');
    expect(result.certificates).toHaveLength(1);
    expect(result.certificates[0]).not.toHaveProperty('documentRef');
    expect(JSON.stringify(result)).not.toContain('private-reference');
    expect(JSON.stringify(result)).not.toContain('private-review');
    expect(database.traceQr.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          lot: {
            include: expect.objectContaining({
              certificates: expect.objectContaining({
                where: expect.objectContaining({
                  isPublic: true,
                  status: 'APPROVED',
                  replacements: { none: { status: 'APPROVED' } },
                }),
              }),
              harvest: {
                include: expect.objectContaining({
                  cycle: {
                    include: expect.objectContaining({
                      certificates: expect.objectContaining({
                        where: expect.objectContaining({
                          isPublic: true,
                          status: 'APPROVED',
                          replacements: { none: { status: 'APPROVED' } },
                        }),
                      }),
                    }),
                  },
                }),
              },
            }),
          },
        },
      }),
    );
  });

  it.each(['PENDING', 'FAILED', 'DEAD_LETTER'] as const)(
    'does not hide earlier %s delivery behind the latest confirmed event',
    async (state) => {
      const { service, database, events } = publicFixture();
      database.traceEvent.findMany.mockResolvedValue([
        {
          ...events[0],
          blockchainProof:
            state === 'DEAD_LETTER'
              ? events[0].blockchainProof
              : { ...events[0].blockchainProof, transactionStatus: state },
          blockchainOutbox: {
            status: state === 'DEAD_LETTER' ? 'DEAD_LETTER' : 'RETRY',
          },
        },
        events[1],
      ]);
      const result = await service.getPublic('test-token');
      expect(result.proofStatus).toBe(
        state === 'PENDING' ? 'PENDING' : 'BLOCKCHAIN_UNAVAILABLE',
      );
      expect(result.timeline[1].proofStatus).toBe('VERIFIED');
    },
  );

  it('keeps sibling harvests out of the query and rejects unknown tokens', async () => {
    const { service, database, events } = publicFixture();
    await service.getPublic('test-token');
    expect(database.traceEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { lotId: events[0].lotId },
            { cycleId: events[0].cycleId, lotId: null },
          ],
        },
      }),
    );
    database.traceQr.findUnique.mockResolvedValue(null);
    await expect(service.getPublic('unknown-token')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('verifies every event before returning VERIFIED without exposing hash input', async () => {
    const { service, actorUserId } = publicFixture();
    const result = await service.getPublic('test-token');
    expect(result.proofStatus).toBe('VERIFIED');
    expect(
      result.timeline.every((event) => event.proofStatus === 'VERIFIED'),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(actorUserId);
    expect(JSON.stringify(result)).not.toContain('actorAuthProof');
    expect(JSON.stringify(result)).not.toContain('businessData');
  });

  it.each(['payload', 'receipt', 'unhashable'] as const)(
    'does not hide an earlier %s integrity problem behind a verified latest event',
    async (problem) => {
      const { service, events } = publicFixture();
      if (problem === 'payload') events[0].businessData.quantity = '99';
      if (problem === 'receipt')
        events[0].blockchainProof.dataHash = 'b'.repeat(64);
      if (problem === 'unhashable') events[0].eventTime = new Date('invalid');
      const result = await service.getPublic('test-token');
      expect(result.proofStatus).toBe('INTEGRITY_WARNING');
      expect(result.timeline[0].proofStatus).toBe('INTEGRITY_WARNING');
      expect(result.timeline[1].proofStatus).toBe('VERIFIED');
    },
  );
});
