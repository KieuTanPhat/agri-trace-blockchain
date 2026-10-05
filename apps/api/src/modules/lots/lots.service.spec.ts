import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { TraceService } from '../trace/trace.service.js';
import { calculateTraceEventHash } from '../trace/public.js';
import { LotsService } from './lots.service.js';
import { LotQueryService } from './lot-query.service.js';
import { RecordHarvestService } from './record-harvest.service.js';

function publicFixture() {
  const lotId = randomUUID();
  const cycleId = randomUUID();
  const actorUserId = randomUUID();
  let previousEventHash: string | null = null;
  const events = [0, 1].map((sequence) => {
    const input = {
      id: randomUUID(),
      entityType: 'LOT',
      entityId: lotId,
      lotId,
      cycleId,
      eventType: 'SHIPMENT_STARTED',
      eventTime: new Date(`2026-09-2${sequence + 5}T00:00:00.000Z`),
      actorUserId,
      actorOrganizationId: randomUUID(),
      actorRole: 'TRANSPORTER',
      authProofType: 'TOKEN_FINGERPRINT',
      actorAuthProof: 'a'.repeat(64),
      businessData: { quantity: '1' },
      previousEventHash,
      schemaVersion: '2.0.0',
      canonicalizationVersion: 'RFC8785',
    };
    const dataHash = calculateTraceEventHash(input);
    previousEventHash = dataHash;
    return {
      ...input,
      dataHash,
      blockchainProof: {
        dataHash,
        transactionStatus: 'CONFIRMED',
        network: 'audit-fixture',
        txId: randomUUID(),
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
          initialQuantity: 1,
          availableQuantity: 1,
          unit: 'kg',
          currentState: 'IN_TRANSIT',
          harvest: {
            harvestTime: events[0].eventTime,
            cycle: {
              id: cycleId,
              cycleCode: 'TEST-CYCLE',
              currentState: 'GROWING',
              startDate: events[0].eventTime,
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
  const service = new LotsService(
    new RecordHarvestService(
      database as unknown as PrismaService,
      {} as OrganizationAccessService,
      {} as TraceService,
    ),
    new LotQueryService(
      database as unknown as PrismaService,
      {} as OrganizationAccessService,
    ),
  );
  return { service, events, actorUserId };
}

describe('Public lot proof projection', () => {
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
