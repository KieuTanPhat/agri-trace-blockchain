import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import { LotsService } from './lots.service.js';

describe('LotsService harvest validation', () => {
  const cycleId = '11111111-1111-1111-1111-111111111111';

  const actor: Actor = {
    sub: '22222222-2222-2222-2222-222222222222',
    organizationId: '33333333-3333-3333-3333-333333333333',
    role: 'FARM_STAFF',
  };

  const tx = {
    productionCycle: {
      findUnique: vi.fn(),
    },
    sensorDigest: {
      findUnique: vi.fn(),
    },
    harvestEvent: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    lot: {
      create: vi.fn(),
    },
    quantityMovement: {
      create: vi.fn(),
    },
    traceQr: {
      create: vi.fn(),
    },
    blockchainProof: {
      create: vi.fn(),
    },
  };

  const prisma = {
    $transaction: vi.fn(
      async (
        callback: (
          transaction: typeof tx,
        ) => Promise<unknown>,
      ) => callback(tx),
    ),
  };

  const access = {
    assertProductionCycleAccess: vi.fn(),
  };

  const trace = {
    createInTransaction: vi.fn(),
  };

  const service = new LotsService(
    prisma as unknown as PrismaService,
    access as unknown as OrganizationAccessService,
    trace as unknown as TraceService,
  );

  beforeEach(() => {
    vi.clearAllMocks();

    access.assertProductionCycleAccess.mockResolvedValue({
      id: cycleId,
      farm: {
        organizationId: actor.organizationId,
      },
    });

    tx.productionCycle.findUnique.mockResolvedValue({
      id: cycleId,
      productId: '44444444-4444-4444-4444-444444444444',
      farmOrgId: actor.organizationId,
      startDate: new Date('2026-09-01T00:00:00.000Z'),
      plannedHarvest: new Date('2026-10-10T00:00:00.000Z'),
      maxHarvestQuantity: new Prisma.Decimal(100),
      harvestUnit: 'kg',
      currentState: 'GROWING',
    });

    tx.harvestEvent.aggregate.mockResolvedValue({
      _sum: {
        quantity: new Prisma.Decimal(0),
      },
    });

    tx.harvestEvent.create.mockImplementation(
      async (argument: {
        data: {
          harvestTime: Date;
          quantity: number;
          unit: string;
        };
      }) => ({
        id: '55555555-5555-5555-5555-555555555555',
        cycleId,
        finalSensorDigestId: null,
        harvestTime: argument.data.harvestTime,
        quantity: new Prisma.Decimal(argument.data.quantity),
        unit: argument.data.unit,
        qualityNote: null,
        grade: null,
        harvestArea: null,
        createdAt: new Date(),
      }),
    );

    tx.lot.create.mockResolvedValue({
      id: '66666666-6666-6666-6666-666666666666',
      lotCode: 'LOT-TEST-001',
      harvestId: '55555555-5555-5555-5555-555555555555',
      productId: '44444444-4444-4444-4444-444444444444',
      farmOrgId: actor.organizationId,
      initialQuantity: new Prisma.Decimal(40),
      availableQuantity: new Prisma.Decimal(40),
      unit: 'kg',
      currentState: 'HARVESTED',
      version: 0,
    });

    trace.createInTransaction.mockResolvedValue({
      id: '77777777-7777-7777-7777-777777777777',
    });

    tx.quantityMovement.create.mockResolvedValue({});
    tx.traceQr.create.mockResolvedValue({
      id: '88888888-8888-8888-8888-888888888888',
      lotId: '66666666-6666-6666-6666-666666666666',
      traceToken: 'test-token',
      traceUrl: 'http://localhost:3000/trace/test-token',
    });
  });

  it('rejects harvest before cycle start date', async () => {
    await expect(
      service.recordHarvest(
        cycleId,
        {
          harvestTime: '2026-08-31T08:00:00.000Z',
          quantity: 10,
          unit: 'kg',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Thời gian thu hoạch không được trước ngày bắt đầu vụ',
    );

    expect(tx.harvestEvent.create).not.toHaveBeenCalled();
  });

  it('rejects harvest time in the future', async () => {
    await expect(
      service.recordHarvest(
        cycleId,
        {
          harvestTime: '2099-10-01T08:00:00.000Z',
          quantity: 10,
          unit: 'kg',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Thời gian thu hoạch không được nằm trong tương lai',
    );

    expect(tx.harvestEvent.create).not.toHaveBeenCalled();
  });

  it('rejects expiry date before harvest date', async () => {
    await expect(
      service.recordHarvest(
        cycleId,
        {
          harvestTime: '2026-10-01T08:00:00.000Z',
          expiryDate: '2026-09-30',
          quantity: 10,
          unit: 'kg',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Ngày hết hạn không được trước ngày thu hoạch',
    );

    expect(tx.harvestEvent.create).not.toHaveBeenCalled();
  });

  it('rejects harvest unit different from cycle unit', async () => {
    await expect(
      service.recordHarvest(
        cycleId,
        {
          harvestTime: '2026-10-01T08:00:00.000Z',
          quantity: 10,
          unit: 'ton',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Đơn vị thu hoạch không khớp kế hoạch',
    );

    expect(tx.harvestEvent.create).not.toHaveBeenCalled();
  });

  it('accepts harvest unit without case sensitivity', async () => {
    const result = await service.recordHarvest(
      cycleId,
      {
        harvestTime: '2026-10-01T08:00:00.000Z',
        quantity: 40,
        unit: 'KG',
        lotCode: 'LOT-TEST-001',
      },
      actor,
    );

    expect(result).toBeDefined();
    expect(tx.harvestEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.lot.create).toHaveBeenCalledTimes(1);
    expect(tx.quantityMovement.create).toHaveBeenCalledTimes(1);
  });

  it('rejects sensor digest from another cycle', async () => {
    tx.sensorDigest.findUnique.mockResolvedValue({
      id: '99999999-9999-9999-9999-999999999999',
      cycleId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      isFinal: true,
    });

    await expect(
      service.recordHarvest(
        cycleId,
        {
          harvestTime: '2026-10-01T08:00:00.000Z',
          quantity: 10,
          unit: 'kg',
          finalSensorDigestId:
            '99999999-9999-9999-9999-999999999999',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Sensor digest cuối kỳ không thuộc chu kỳ hoặc chưa được finalize',
    );

    expect(tx.harvestEvent.create).not.toHaveBeenCalled();
  });

  it('rejects sensor digest that is not finalized', async () => {
    tx.sensorDigest.findUnique.mockResolvedValue({
      id: '99999999-9999-9999-9999-999999999999',
      cycleId,
      isFinal: false,
    });

    await expect(
      service.recordHarvest(
        cycleId,
        {
          harvestTime: '2026-10-01T08:00:00.000Z',
          quantity: 10,
          unit: 'kg',
          finalSensorDigestId:
            '99999999-9999-9999-9999-999999999999',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Sensor digest cuối kỳ không thuộc chu kỳ hoặc chưa được finalize',
    );

    expect(tx.harvestEvent.create).not.toHaveBeenCalled();
  });

  it('allows total harvest quantity equal to cycle limit', async () => {
    tx.harvestEvent.aggregate.mockResolvedValue({
      _sum: {
        quantity: new Prisma.Decimal(60),
      },
    });

    await expect(
      service.recordHarvest(
        cycleId,
        {
          harvestTime: '2026-10-01T08:00:00.000Z',
          quantity: 40,
          unit: 'kg',
          lotCode: 'LOT-TEST-LIMIT',
        },
        actor,
      ),
    ).resolves.toBeDefined();

    expect(tx.harvestEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects total harvest quantity greater than cycle limit', async () => {
    tx.harvestEvent.aggregate.mockResolvedValue({
      _sum: {
        quantity: new Prisma.Decimal(60),
      },
    });

    await expect(
      service.recordHarvest(
        cycleId,
        {
          harvestTime: '2026-10-01T08:00:00.000Z',
          quantity: 41,
          unit: 'kg',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Tổng sản lượng thu hoạch vượt giới hạn của chu kỳ',
    );

    expect(tx.harvestEvent.create).not.toHaveBeenCalled();
    expect(tx.lot.create).not.toHaveBeenCalled();
  });
});
