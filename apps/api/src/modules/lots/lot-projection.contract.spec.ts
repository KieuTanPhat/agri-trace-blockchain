import { vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { TraceService } from '../trace/trace.service.js';
import { calculateTraceEventHash } from '../trace/public.js';
import { LotsService } from './lots.service.js';
import { LotQueryService } from './lot-query.service.js';
import { RecordHarvestService } from './record-harvest.service.js';

const actor = { sub: 'user-farm', role: 'SYSTEM_ADMIN', organizationId: null };

function projectionFixture() {
  const time = new Date('2026-09-25T00:00:00.000Z');
  function event(id: string, lotId: string | null, type: string) {
    const input = {
      id,
      entityType: lotId ? 'LOT' : 'PRODUCTION_CYCLE',
      entityId: lotId ?? 'cycle-1',
      lotId,
      cycleId: 'cycle-1',
      eventType: type,
      eventTime: time,
      createdAt: time,
      actorUserId: 'user-farm',
      actorOrganizationId: 'org-farm',
      actorRole: 'FARM_STAFF',
      authProofType: 'TOKEN_FINGERPRINT',
      actorAuthProof: 'a'.repeat(64),
      businessData: { quantity: '20.75' },
      previousEventHash: null,
      schemaVersion: '2.0.0',
      canonicalizationVersion: 'RFC8785',
    };
    const dataHash = calculateTraceEventHash(input);
    return {
      ...input,
      dataHash,
      actor: { id: 'user-farm' },
      organization: { id: 'org-farm', name: 'Farm organization' },
      blockchainProof: {
        dataHash,
        transactionStatus: 'CONFIRMED',
        network: 'fixture-network',
        txId: 'tx-' + id,
        channelId: 'agritrace',
        recordedAt: time,
      },
      blockchainOutbox: { status: 'COMPLETED' },
    };
  }
  const cycleEvent = event('event-cycle', null, 'CYCLE_PLANTED');
  const lotEvent = event('event-harvest', 'lot-1', 'HARVEST_RECORDED');
  const lot = {
    id: 'lot-1',
    lotCode: 'LOT-FIXTURE',
    currentState: 'HARVESTED',
    version: 0,
    farmOrgId: 'org-farm',
    product: { productName: 'Vegetables' },
    organization: { id: 'org-farm', name: 'Farm organization', type: 'FARM' },
    initialQuantity: new Prisma.Decimal('20.75'),
    availableQuantity: new Prisma.Decimal('20.5'),
    unit: 'kg',
    harvest: {
      harvestTime: time,
      cycle: {
        id: 'cycle-1',
        cycleCode: 'CYCLE-FIXTURE',
        currentState: 'GROWING',
        startDate: time,
        farm: { organizationId: 'org-farm', name: 'Farm' },
        traceEvents: [cycleEvent],
      },
    },
    shipment: null,
    traceEvents: [lotEvent],
    certificates: [],
    inspections: [],
    quantityMovements: [
      {
        id: 'movement-1',
        type: 'DAMAGE_OUT',
        quantity: new Prisma.Decimal('0.25'),
        beforeQty: new Prisma.Decimal('20.75'),
        delta: new Prisma.Decimal('-0.25'),
        afterQty: new Prisma.Decimal('20.5'),
        unit: 'kg',
        createdAt: time,
      },
    ],
    traceQr: { traceToken: 'fixture-token' },
  };
  const db = {
    lot: {
      findUnique: vi.fn().mockResolvedValue(lot),
      findMany: vi.fn().mockResolvedValue([lot]),
    },
    traceQr: { findUnique: vi.fn().mockResolvedValue({ lot }) },
    traceEvent: { findMany: vi.fn().mockResolvedValue([cycleEvent, lotEvent]) },
  };
  const access = { assertLotAccess: vi.fn().mockResolvedValue(lot) };
  const service = new LotsService(
    new RecordHarvestService(
      db as unknown as PrismaService,
      access as unknown as OrganizationAccessService,
      {} as TraceService,
    ),
    new LotQueryService(
      db as unknown as PrismaService,
      access as unknown as OrganizationAccessService,
    ),
  );
  return { service, db, lot, cycleEvent, lotEvent };
}

const wire = (data: unknown) => JSON.parse(JSON.stringify(data));

describe('Lot API response contracts captured before refactoring', () => {
  it('preserves the serialized internal response, decimals and tied event order', async () => {
    const { service } = projectionFixture();
    expect(wire(await service.getInternal('lot-1', actor))).toMatchSnapshot();
  });

  it('preserves the public projection and excludes private hash input', async () => {
    const { service } = projectionFixture();
    const result = wire(await service.getPublic('fixture-token'));
    expect(result).toMatchSnapshot();
    expect(JSON.stringify(result)).not.toContain('user-farm');
    expect(JSON.stringify(result)).not.toContain('actorAuthProof');
    expect(JSON.stringify(result)).not.toContain('businessData');
  });

  it('preserves dashboard labels, string counts and the featured lot', async () => {
    const { service } = projectionFixture();
    expect(wire(await service.getDashboard(actor))).toMatchSnapshot();
  });

  it('preserves the empty dashboard response', async () => {
    const { service, db } = projectionFixture();
    db.lot.findMany.mockResolvedValue([]);
    expect(wire(await service.getDashboard(actor))).toEqual({
      featuredLot: null,
      stats: [
        { label: 'Lô đang theo dõi', value: '0' },
        { label: 'Bằng chứng đang chờ', value: '0' },
        { label: 'Chuyến vận chuyển mở', value: '0' },
      ],
    });
  });

  it('loads full relations only for the featured lot', async () => {
    const { service, db } = projectionFixture();
    await service.getDashboard(actor);
    const options = db.lot.findMany.mock.calls[0]?.[0] as unknown as {
      select: Record<string, unknown>;
      include?: unknown;
    };
    expect(options.include).toBeUndefined();
    expect(options.select).not.toHaveProperty('quantityMovements');
    expect(options.select).not.toHaveProperty('certificates');
    expect(options.select).not.toHaveProperty('inspections');
    expect(db.lot.findUnique).toHaveBeenCalledTimes(1);
    expect(db.lot.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lot-1' } }),
    );
  });

  it('keeps integrity warnings out of the pending proof count', async () => {
    const { service, cycleEvent, lotEvent } = projectionFixture();
    cycleEvent.businessData.quantity = '99';
    lotEvent.blockchainProof.transactionStatus = 'SUBMITTED';
    const dashboard = await service.getDashboard(actor);
    expect(dashboard.featuredLot?.proofStatus).toBe('INTEGRITY_WARNING');
    expect(dashboard.stats[1].value).toBe('0');
  });
});
