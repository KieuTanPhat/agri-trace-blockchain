import { UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import { ProductionCyclesService } from './production-cycles.service.js';

describe('ProductionCyclesService validation', () => {
  const actor: Actor = {
    sub: '11111111-1111-1111-1111-111111111111',
    organizationId: '22222222-2222-2222-2222-222222222222',
    role: 'FARM_STAFF',
  };

  const prisma = {
    product: {
      findUnique: vi.fn(),
    },
    plot: {
      findUnique: vi.fn(),
    },
    productionCycle: {
      findUnique: vi.fn(),
    },
    iotDevice: {
      findUnique: vi.fn(),
    },
    sensorReading: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const access = {
    assertFarmAccess: vi.fn(),
    assertProductionCycleAccess: vi.fn(),
  };

  const trace = {
    createInTransaction: vi.fn(),
  };

  const service = new ProductionCyclesService(
    prisma as unknown as PrismaService,
    access as unknown as OrganizationAccessService,
    trace as unknown as TraceService,
  );

  beforeEach(() => {
    vi.resetAllMocks();

    access.assertFarmAccess.mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
      organizationId: actor.organizationId,
    });

    access.assertProductionCycleAccess.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      farm: {
        organizationId: actor.organizationId,
      },
    });

    prisma.product.findUnique.mockResolvedValue({
      id: '55555555-5555-5555-5555-555555555555',
      productName: 'Rau cải xanh',
      defaultUnit: 'kg',
      status: 'ACTIVE',
    });

    prisma.plot.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue({});
  });

  it('rejects planned harvest before cycle start date', async () => {
    await expect(
      service.create(
        {
          farmId: '33333333-3333-3333-3333-333333333333',
          productId: '55555555-5555-5555-5555-555555555555',
          cycleCode: 'CYCLE-001',
          startDate: '2026-10-10',
          plannedHarvest: '2026-10-09',
          maxHarvestQuantity: 100,
          harvestUnit: 'kg',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects harvest unit different from product default unit', async () => {
    await expect(
      service.create(
        {
          farmId: '33333333-3333-3333-3333-333333333333',
          productId: '55555555-5555-5555-5555-555555555555',
          cycleCode: 'CYCLE-002',
          startDate: '2026-10-01',
          plannedHarvest: '2026-10-10',
          maxHarvestQuantity: 100,
          harvestUnit: 'ton',
        },
        actor,
      ),
    ).rejects.toThrow('Đơn vị thu hoạch phải là kg');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts harvest unit without case sensitivity', async () => {
    await service.create(
      {
        farmId: '33333333-3333-3333-3333-333333333333',
        productId: '55555555-5555-5555-5555-555555555555',
        cycleCode: 'CYCLE-003',
        startDate: '2026-10-01',
        plannedHarvest: '2026-10-10',
        maxHarvestQuantity: 100,
        harvestUnit: 'KG',
      },
      actor,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects planting after planned harvest date', async () => {
    prisma.productionCycle.findUnique.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      plannedHarvest: new Date('2026-10-10T00:00:00.000Z'),
      startDate: null,
    });

    await expect(
      service.plant(
        '44444444-4444-4444-4444-444444444444',
        {
          version: 0,
          plantedAt: '2026-10-11T08:00:00.000Z',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Ngày gieo trồng không được sau ngày thu hoạch dự kiến',
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows planting during the planned harvest date', async () => {
    prisma.productionCycle.findUnique.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      plannedHarvest: new Date('2026-10-10T00:00:00.000Z'),
      startDate: null,
    });

    await service.plant(
      '44444444-4444-4444-4444-444444444444',
      {
        version: 0,
        plantedAt: '2026-10-10T08:00:00.000Z',
      },
      actor,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects care record before cycle start date', async () => {
    prisma.productionCycle.findUnique.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      startDate: new Date('2026-10-05T00:00:00.000Z'),
      plannedHarvest: new Date('2026-10-20T00:00:00.000Z'),
    });

    await expect(
      service.addCare(
        '44444444-4444-4444-4444-444444444444',
        {
          version: 1,
          careType: 'Tưới nước',
          eventTime: '2026-10-04T08:00:00.000Z',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Thời gian chăm sóc không được trước ngày bắt đầu vụ',
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects care quantity without unit', async () => {
    prisma.productionCycle.findUnique.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      plannedHarvest: new Date('2026-10-20T00:00:00.000Z'),
    });

    await expect(
      service.addCare(
        '44444444-4444-4444-4444-444444444444',
        {
          version: 1,
          careType: 'Bón phân',
          eventTime: '2026-10-05T08:00:00.000Z',
          quantity: 5,
        },
        actor,
      ),
    ).rejects.toThrow(
      'Số lượng và đơn vị chăm sóc phải được nhập cùng nhau',
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects care unit without quantity', async () => {
    prisma.productionCycle.findUnique.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      plannedHarvest: new Date('2026-10-20T00:00:00.000Z'),
    });

    await expect(
      service.addCare(
        '44444444-4444-4444-4444-444444444444',
        {
          version: 1,
          careType: 'Bón phân',
          eventTime: '2026-10-05T08:00:00.000Z',
          unit: 'kg',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Số lượng và đơn vị chăm sóc phải được nhập cùng nhau',
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects sensor reading before cycle start date', async () => {
    prisma.productionCycle.findUnique.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      startDate: new Date('2026-10-05T00:00:00.000Z'),
      plannedHarvest: new Date('2026-10-20T00:00:00.000Z'),
      farm: {
        organizationId: actor.organizationId,
      },
    });

    await expect(
      service.addSensorReading(
        '44444444-4444-4444-4444-444444444444',
        {
          deviceId: '66666666-6666-6666-6666-666666666666',
          sensorType: 'TEMPERATURE',
          value: 28,
          unit: 'C',
          recordedAt: '2026-10-04T08:00:00.000Z',
        },
        actor,
      ),
    ).rejects.toThrow(
      'Thời gian cảm biến không được trước ngày bắt đầu vụ',
    );

    expect(prisma.iotDevice.findUnique).not.toHaveBeenCalled();
    expect(prisma.sensorReading.create).not.toHaveBeenCalled();
  });
});