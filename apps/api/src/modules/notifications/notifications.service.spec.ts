import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  NotificationSeverity,
  NotificationType,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  const farmActor = {
    sub: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    role: 'FARM_STAFF',
  };

  it('lists only notifications addressed to the current user', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      notification: { findMany, count },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    } as unknown as PrismaService;

    const service = new NotificationsService(prisma);
    await service.listNotifications(farmActor, { page: 1, limit: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ recipientUserId: farmActor.sub }),
      }),
    );
  });

  it('does not allow reading another user notification', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new NotificationsService({
      notification: { updateMany, findFirst },
    } as unknown as PrismaService);

    await expect(service.markRead('33333333-3333-4333-8333-333333333333', farmActor))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ recipientUserId: farmActor.sub }),
      }),
    );
  });

  it('rejects a rule for another organization', async () => {
    const service = new NotificationsService({} as PrismaService);
    await expect(service.createRule({
      organizationId: '44444444-4444-4444-8444-444444444444',
      sensorType: 'temperature',
      maximumValue: 30,
    }, farmActor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('inserts one notification per recipient and skips duplicate keys', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new NotificationsService({
      user: {
        findMany: vi.fn().mockResolvedValue([{
          id: farmActor.sub,
          organizationId: farmActor.organizationId,
          role: { code: farmActor.role },
        }]),
      },
      notification: { createMany },
    } as unknown as PrismaService);

    await service.createForRecipients({
      organizationId: farmActor.organizationId,
      recipientUserIds: [farmActor.sub, farmActor.sub],
      type: NotificationType.SENSOR_THRESHOLD_EXCEEDED,
      severity: NotificationSeverity.WARNING,
      title: 'Vượt ngưỡng',
      message: 'Nhiệt độ cao',
      entityType: 'SENSOR_READING',
      entityId: '55555555-5555-4555-8555-555555555555',
      dedupKey: 'sensor-threshold:rule:device:HIGH:2026-10-05',
    });

    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ recipientUserId: farmActor.sub })],
      skipDuplicates: true,
    }));
  });
});
