import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import {
  SensorHistoryInterval,
  type SensorHistoryQueryDto,
  type ShipmentTelemetryQueryDto,
} from './dto.js';
import { SensorHistoryService } from './sensor-history.service.js';

describe('SensorHistoryService', () => {
  const cycleId = '11111111-1111-1111-1111-111111111111';
  const deviceId = '22222222-2222-2222-2222-222222222222';
  const harvestId = '33333333-3333-3333-3333-333333333333';
  const shipmentId = '44444444-4444-4444-4444-444444444444';
  const organizationId =
    '55555555-5555-5555-5555-555555555555';

  const actor: Actor = {
    sub: '66666666-6666-6666-6666-666666666666',
    organizationId,
    role: 'FARM_STAFF',
  };

  const prisma = {
    sensorReading: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    shipmentTelemetry: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    harvestEvent: {
      findUnique: vi.fn(),
    },
    iotDevice: {
      findUnique: vi.fn(),
    },
    shipmentTrackingBinding: {
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };

  const access = {
    assertProductionCycleAccess: vi.fn(),
    assertShipmentAccess: vi.fn(),
  };

  const service = new SensorHistoryService(
    prisma as unknown as PrismaService,
    access as unknown as OrganizationAccessService,
  );

  beforeEach(() => {
    vi.resetAllMocks();

    access.assertProductionCycleAccess.mockResolvedValue({
      id: cycleId,
      farm: {
        organizationId,
      },
    });

    access.assertShipmentAccess.mockResolvedValue({
      id: shipmentId,
    });

    prisma.sensorReading.findMany.mockResolvedValue([]);
    prisma.sensorReading.count.mockResolvedValue(0);

    prisma.shipmentTelemetry.findMany.mockResolvedValue([]);
    prisma.shipmentTelemetry.count.mockResolvedValue(0);

    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('rejects reading query without a scope', async () => {
    const query = {
      interval: SensorHistoryInterval.RAW,
      page: 1,
      limit: 100,
    } as SensorHistoryQueryDto;

    await expect(
      service.getReadings(query, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(
      access.assertProductionCycleAccess,
    ).not.toHaveBeenCalled();
  });

  it('returns raw readings with pagination', async () => {
    prisma.sensorReading.findMany.mockResolvedValue([
      {
        id: '77777777-7777-7777-7777-777777777777',
        cycleId,
        deviceId,
        sensorType: 'TEMPERATURE',
        value: 27.5,
        unit: 'C',
        recordedAt: new Date('2026-10-01T08:00:00.000Z'),
        ingestTime: new Date('2026-10-01T08:00:01.000Z'),
      },
    ]);

    prisma.sensorReading.count.mockResolvedValue(51);

    const result = await service.getReadings(
      {
        cycleId,
        interval: SensorHistoryInterval.RAW,
        page: 2,
        limit: 50,
      },
      actor,
    );

    expect(
      access.assertProductionCycleAccess,
    ).toHaveBeenCalledWith(actor, cycleId);

    expect(prisma.sensorReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 50,
        take: 50,
        orderBy: {
          recordedAt: 'asc',
        },
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        mode: SensorHistoryInterval.RAW,
        pagination: {
          page: 2,
          limit: 50,
          total: 51,
          totalPages: 2,
        },
      }),
    );
  });

  it('uses sensor digest period when querying by harvest', async () => {
    const periodStart = new Date(
      '2026-09-01T00:00:00.000Z',
    );
    const periodEnd = new Date(
      '2026-09-30T23:59:59.000Z',
    );

    prisma.harvestEvent.findUnique.mockResolvedValue({
      id: harvestId,
      cycleId,
      finalSensorDigest: {
        periodStart,
        periodEnd,
      },
    });

    await service.getReadings(
      {
        harvestId,
        interval: SensorHistoryInterval.RAW,
        page: 1,
        limit: 100,
      },
      actor,
    );

    expect(prisma.sensorReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycleId,
          recordedAt: {
            gte: periodStart,
            lte: periodEnd,
          },
        }),
      }),
    );
  });

  it('requires from and to when harvest has no final digest', async () => {
    prisma.harvestEvent.findUnique.mockResolvedValue({
      id: harvestId,
      cycleId,
      finalSensorDigest: null,
    });

    await expect(
      service.getReadings(
        {
          harvestId,
          interval: SensorHistoryInterval.RAW,
          page: 1,
          limit: 100,
        },
        actor,
      ),
    ).rejects.toThrow(
      'Lần thu hoạch chưa có sensor digest; cần cung cấp from và to',
    );
  });

  it('rejects a device owned by another organization', async () => {
    prisma.iotDevice.findUnique.mockResolvedValue({
      id: deviceId,
      organizationId:
        '88888888-8888-8888-8888-888888888888',
      cycleId,
    });

    await expect(
      service.getReadings(
        {
          deviceId,
          interval: SensorHistoryInterval.RAW,
          page: 1,
          limit: 100,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.sensorReading.findMany).not.toHaveBeenCalled();
  });

  it('rejects from after to', async () => {
    await expect(
      service.getReadings(
        {
          cycleId,
          from: '2026-10-10T00:00:00.000Z',
          to: '2026-10-01T00:00:00.000Z',
          interval: SensorHistoryInterval.RAW,
          page: 1,
          limit: 100,
        },
        actor,
      ),
    ).rejects.toThrow(
      'Thời gian bắt đầu không được sau thời gian kết thúc',
    );
  });

  it('returns hourly sensor aggregation', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        bucket: new Date('2026-10-01T08:00:00.000Z'),
        sensorType: 'TEMPERATURE',
        unit: 'C',
        readingCount: BigInt(12),
        minimum: 25.1,
        maximum: 29.4,
        average: 27.2,
      },
    ]);

    const result = await service.getReadings(
      {
        cycleId,
        interval: SensorHistoryInterval.HOUR,
        page: 1,
        limit: 100,
      },
      actor,
    );

    expect(result).toEqual({
      mode: SensorHistoryInterval.HOUR,
      interval: SensorHistoryInterval.HOUR,
      series: [
        {
          bucket: new Date('2026-10-01T08:00:00.000Z'),
          sensorType: 'TEMPERATURE',
          unit: 'C',
          count: 12,
          min: 25.1,
          max: 29.4,
          avg: 27.2,
        },
      ],
    });
  });

  it('checks shipment access before returning telemetry', async () => {
    const query: ShipmentTelemetryQueryDto = {
      shipmentId,
      interval: SensorHistoryInterval.RAW,
      page: 1,
      limit: 100,
    };

    await service.getShipmentTelemetry(query, actor);

    expect(access.assertShipmentAccess).toHaveBeenCalledWith(
      actor,
      shipmentId,
    );

    expect(
      prisma.shipmentTelemetry.findMany,
    ).toHaveBeenCalled();
  });

  it('does not return telemetry when shipment access is denied', async () => {
    access.assertShipmentAccess.mockRejectedValue(
      new ForbiddenException(
        'Không có quyền xem chuyến vận chuyển',
      ),
    );

    await expect(
      service.getShipmentTelemetry(
        {
          shipmentId,
          interval: SensorHistoryInterval.RAW,
          page: 1,
          limit: 100,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      prisma.shipmentTelemetry.findMany,
    ).not.toHaveBeenCalled();
  });

  it('rejects device not bound to the shipment', async () => {
    prisma.iotDevice.findUnique.mockResolvedValue({
      id: deviceId,
      organizationId,
      cycleId: null,
    });

    prisma.shipmentTrackingBinding.findFirst.mockResolvedValue(
      null,
    );

    await expect(
      service.getShipmentTelemetry(
        {
          shipmentId,
          deviceId,
          interval: SensorHistoryInterval.RAW,
          page: 1,
          limit: 100,
        },
        actor,
      ),
    ).rejects.toThrow(
      'Thiết bị không được gắn với chuyến vận chuyển này',
    );
  });
});