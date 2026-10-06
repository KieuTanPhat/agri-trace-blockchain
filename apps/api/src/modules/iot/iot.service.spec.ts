import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TraceService } from '../trace/trace.service.js';
import { IotService } from './iot.service.js';

describe('IotService', () => {
  const device = {
    id: '8b83ea4b-bf3b-491d-8640-428f4874eacf',
    deviceCode: 'sensor-a',
    cycleId: '895987d6-fb06-41a0-adca-0f6c10570aec',
    organizationId: '79a21bd7-e204-44d9-89ae-9ccf9fd4b358',
    status: 'ACTIVE',
  };
  const input = {
    deviceId: device.deviceCode,
    cycleId: device.cycleId,
    sensorType: 'TEMPERATURE',
    value: 27.5,
    unit: 'C',
    recordedAt: '2026-09-21T00:00:00.000Z',
  };

  it('rejects a farm user from another organization', async () => {
    const prisma = {
      iotDevice: { findFirst: vi.fn().mockResolvedValue(device) },
    };
    const service = new IotService(
      prisma as unknown as PrismaService,
      {} as TraceService,
    );

    await expect(
      service.ingest(input, {
        sub: '2f15e78c-6b9e-4070-aafb-34f22847d307',
        organizationId: '3b68af09-d7de-4539-adb5-152263843f77',
        role: 'FARM_STAFF',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores a raw reading without creating a blockchain trace event', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'reading-1' });
    const update = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (callback) =>
      callback({ sensorReading: { create }, iotDevice: { update } }),
    );
    const prisma = {
      iotDevice: { findFirst: vi.fn().mockResolvedValue(device) },
      productionCycle: {
        findUnique: vi.fn().mockResolvedValue({ currentState: 'GROWING' }),
      },
      $transaction: transaction,
    };
    const trace = { createInTransaction: vi.fn() };
    const service = new IotService(
      prisma as unknown as PrismaService,
      trace as unknown as TraceService,
    );

    await expect(service.ingest(input)).resolves.toEqual({
      status: 'accepted',
      readingId: 'reading-1',
    });
    expect(trace.createInTransaction).not.toHaveBeenCalled();
  });
});
