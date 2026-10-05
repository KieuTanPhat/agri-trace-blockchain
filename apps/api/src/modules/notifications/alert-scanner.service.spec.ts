import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AlertScannerService } from './alert-scanner.service.js';
import { NotificationsService } from './notifications.service.js';

describe('AlertScannerService', () => {
  it('routes an expiring lot to farm and retailer and a failed proof to admin', async () => {
    const farmOrgId = '11111111-1111-4111-8111-111111111111';
    const retailerOrgId = '22222222-2222-4222-8222-222222222222';
    const createForRecipients = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'farm-user', organizationId: farmOrgId, role: { code: 'FARM_STAFF' }, organization: { status: 'ACTIVE' } },
          { id: 'retailer-user', organizationId: retailerOrgId, role: { code: 'RETAILER' }, organization: { status: 'ACTIVE' } },
          { id: 'admin-user', organizationId: null, role: { code: 'SYSTEM_ADMIN' }, organization: null },
        ]),
      },
      lot: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'lot-id', lotCode: 'LOT-1', farmOrgId,
          expiryDate: new Date('2026-10-08T00:00:00Z'),
          shipment: { retailerOrgId },
        }]),
      },
      certificate: { findMany: vi.fn().mockResolvedValue([]) },
      sensorAlertRule: { findMany: vi.fn().mockResolvedValue([]) },
      blockchainProof: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'proof-id', eventId: 'event-id', lastError: 'failed',
          traceEvent: { actorOrganizationId: null, lot: { farmOrgId }, cycle: null },
        }]),
      },
    } as unknown as PrismaService;
    const scanner = new AlertScannerService(prisma, {
      createForRecipients,
    } as unknown as NotificationsService);

    const result = await scanner.scan(new Date('2026-10-05T12:00:00Z'));

    expect(result.created).toBe(4);
    expect(createForRecipients).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: farmOrgId,
      recipientUserIds: ['farm-user'],
      dedupKey: 'lot-expiring:lot-id',
    }));
    expect(createForRecipients).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: retailerOrgId,
      recipientUserIds: ['retailer-user'],
      dedupKey: 'lot-expiring:lot-id',
    }));
    expect(createForRecipients).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: null,
      recipientUserIds: ['admin-user'],
      dedupKey: 'blockchain-failed:proof-id',
    }));
  });

  it('detects an approved certificate near expiry', async () => {
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const createForRecipients = vi.fn().mockResolvedValue({ count: 1 });
    const scanner = new AlertScannerService({
      user: { findMany: vi.fn().mockResolvedValue([{
        id: 'farm-user', organizationId,
        role: { code: 'FARM_STAFF' }, organization: { status: 'ACTIVE' },
      }]) },
      lot: { findMany: vi.fn().mockResolvedValue([]) },
      certificate: { findMany: vi.fn().mockResolvedValue([{
        id: 'certificate-id', type: 'VietGAP',
        expiryDate: new Date('2026-10-10T00:00:00Z'),
        lot: { farmOrgId: organizationId }, cycle: null,
      }]) },
      sensorAlertRule: { findMany: vi.fn().mockResolvedValue([]) },
      blockchainProof: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService, {
      createForRecipients,
    } as unknown as NotificationsService);

    const result = await scanner.scan(new Date('2026-10-05T12:00:00Z'));
    expect(result.certificateExpiring).toBe(1);
    expect(createForRecipients).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      recipientUserIds: ['farm-user'],
      dedupKey: 'certificate-expiring:certificate-id',
    }));
  });

  it('reports only the latest out-of-range reading per device', async () => {
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const readingFindMany = vi.fn().mockResolvedValue([{
      id: 'reading-id', deviceId: 'device-id',
      value: new Prisma.Decimal(35), unit: 'C',
      recordedAt: new Date('2026-10-05T11:00:00Z'),
    }]);
    const createForRecipients = vi.fn().mockResolvedValue({ count: 1 });
    const scanner = new AlertScannerService({
      user: { findMany: vi.fn().mockResolvedValue([{
        id: 'farm-user', organizationId,
        role: { code: 'FARM_STAFF' }, organization: { status: 'ACTIVE' },
      }]) },
      lot: { findMany: vi.fn().mockResolvedValue([]) },
      certificate: { findMany: vi.fn().mockResolvedValue([]) },
      sensorAlertRule: { findMany: vi.fn().mockResolvedValue([{
        id: 'rule-id', organizationId, deviceId: null,
        sensorType: 'temperature', minimumValue: null,
        maximumValue: new Prisma.Decimal(30), severity: 'WARNING',
      }]) },
      sensorReading: { findMany: readingFindMany },
      blockchainProof: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService, {
      createForRecipients,
    } as unknown as NotificationsService);

    const result = await scanner.scan(new Date('2026-10-05T12:00:00Z'));
    expect(result.sensorThresholdExceeded).toBe(1);
    expect(readingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      distinct: ['deviceId'],
      orderBy: { recordedAt: 'desc' },
    }));
    expect(createForRecipients).toHaveBeenCalledWith(expect.objectContaining({
      dedupKey: 'sensor-threshold:rule-id:device-id:HIGH:2026-10-05',
    }));
  });
});
