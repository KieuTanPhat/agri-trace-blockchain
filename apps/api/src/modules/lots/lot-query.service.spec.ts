import { randomUUID, randomBytes } from 'node:crypto';
import { vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { OrganizationAccessService } from '../auth/organization-access.service.js';
import { LotQueryService } from './lot-query.service.js';
import type { PublicLot } from './lot-query.types.js';
import { Prisma } from '../../generated/prisma/client.js';
import { bindingEvent } from '../../../test/support/binding-event-fixture.js';
import { aggregateLotProofStatus } from './lot-proof-status.js';
import { publicLotInclude } from './lot-query.types.js';

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
    const committed = bindingEvent(input, sequence + 1);
    const dataHash = committed.dataHash;
    return {
      ...committed,
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
    careRecord: { findMany: vi.fn().mockResolvedValue([]) },
    distributionLine: { findMany: vi.fn().mockResolvedValue([]) },
    distributionReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    distributionRemainder: { findMany: vi.fn().mockResolvedValue([]) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    traceQrBlock: { findFirst: vi.fn().mockResolvedValue(null) },
    traceNotice: { findMany: vi.fn().mockResolvedValue([]) },
    organization: { findMany: vi.fn().mockResolvedValue([]) },
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
    {build:vi.fn().mockResolvedValue([]),thumbnailUrl:vi.fn().mockResolvedValue('/public/trace/test/thumbnail')} as unknown as import('./public-journey.service.js').PublicJourneyService,
  );
  return { service, events, actorUserId, database };
}

describe('Public lot proof projection', () => {
  it('allows only public shipment fields even when the loaded object contains secrets', async () => {
    const { service, database } = publicFixture();
    const qr = await database.traceQr.findUnique();
    qr.lot.shipment = {
      status: 'CREATED', origin: 'Farm', destination: 'Shop',
      pickupTime: null, arrivalTime: null, receivedTime: null,
      driverPhone: 'private-phone', internalNote: 'private-note',
    };
    const result = await service.getPublic('test-token');
    expect(result.shipment).toEqual({
      status: 'CREATED', origin: 'Farm', destination: 'Shop',
      pickupTime: null, arrivalTime: null, receivedTime: null,
    });
    expect(JSON.stringify(result)).not.toContain('private-phone');
    expect(JSON.stringify(result)).not.toContain('private-note');
  });

  it('retains recall and expiry warnings alongside verified evidence', async () => {
    const { service, database } = publicFixture();
    const qr = await database.traceQr.findUnique();
    qr.lot.currentState = 'RECALLED';
    qr.lot.expiryDate = new Date('2000-01-01');
    const result = await service.getPublic('test-token');
    expect(result.proofStatus).toBe('VERIFIED');
    expect(result.warnings.slice(0, 2)).toEqual(['RECALLED', 'EXPIRED']);
    expect(result.isExpired).toBe(true);
  });

  it('applies certificate validity at the Vietnam date boundary on lot and cycle', () => {
    const include = publicLotInclude(new Date('2026-10-27T17:00:00Z'));
    const certificates = include.certificates;
    expect(certificates.where).toEqual({
      isPublic: true, status: 'APPROVED',
      replacements: { none: { status: 'APPROVED' } },
      issueDate: { lte: new Date('2026-10-28T00:00:00Z') },
      OR: [{ expiryDate: null }, { expiryDate: { gte: new Date('2026-10-28T00:00:00Z') } }],
    });
    expect(include.harvest.include.cycle.include.certificates).toEqual(certificates);
  });

  it('treats empty history as pending and preserves priority independently of event order', () => {
    const { events } = publicFixture();
    const pending = { ...events[0], blockchainProof: null };
    const unavailable = { ...pending, blockchainOutbox: { status: 'DEAD_LETTER' } };
    const corrupt = { ...events[0], dataHash: 'corrupt' };
    expect(aggregateLotProofStatus([])).toBe('PENDING');
    for (const reverse of [false, true]) {
      for (const [history, expected] of [
        [[pending, events[1]], 'PENDING'],
        [[unavailable, pending, events[1]], 'BLOCKCHAIN_UNAVAILABLE'],
        [[corrupt, unavailable, pending, events[1]], 'INTEGRITY_WARNING'],
      ] as const) {
        expect(aggregateLotProofStatus(reverse ? [...history].reverse() : [...history])).toBe(expected);
      }
    }
  });
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
    expect(database.traceQr.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { traceToken: 'test-token' } }),
    );
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

  it.each(['payload', 'actor', 'receipt', 'unhashable'] as const)(
    'does not hide an earlier %s integrity problem behind a verified latest event',
    async (problem) => {
      const { service, events } = publicFixture();
      if (problem === 'payload') events[0].businessData.quantity = '99';
      if (problem === 'actor') events[0].actorRole = 'RETAILER';
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
