import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  WorkspaceService,
  lotScope,
  timeRange,
  sensorAlert,
  sensorThresholds,
} from './workspace.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { OrganizationAccessService } from '../auth/organization-access.service.js';
import { HistoryQuery } from './dto.js';

const actor = { sub: 'user', role: 'FARM_STAFF', organizationId: 'farm' };
function setup() {
  const db = {
    lot: { findMany: vi.fn(), findFirst: vi.fn() },
    traceEvent: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    notificationRead: { findMany: vi.fn(), upsert: vi.fn() },
    mediaAttachment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    product: { findUnique: vi.fn() },
    certificate: { findUnique: vi.fn() },
    traceQr: { findUnique: vi.fn() },
    harvestEvent: { findFirst: vi.fn() },
    sensorReading: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (task) =>
    typeof task === 'function' ? task(db) : Promise.all(task),
  );
  const access = {
    assertShipmentAccess: vi.fn(),
    assertLotAccess: vi.fn().mockResolvedValue({ farmOrgId: 'farm' }),
    assertProductionCycleAccess: vi.fn(),
  };
  return {
    db,
    access,
    service: new WorkspaceService(
      db as unknown as PrismaService,
      access as unknown as OrganizationAccessService,
    ),
  };
}
afterEach(() => vi.unstubAllEnvs());
describe('workspace authorization and reporting', () => {
  it('fails closed for missing organization and unknown role', () => {
    expect(lotScope({ ...actor, organizationId: null })).toEqual({
      farmOrgId: '00000000-0000-0000-0000-000000000000',
    });
    expect(lotScope({ ...actor, role: 'IOT_DEVICE' })).toHaveProperty('id');
    expect(lotScope({ ...actor, role: 'TRANSPORTER' })).toEqual({
      shipment: { transporterOrgId: 'farm' },
    });
  });
  it('rejects reversed date ranges', () =>
    expect(() =>
      timeRange({
        ...new HistoryQuery(),
        from: '2026-10-05',
        to: '2026-10-04',
      }),
    ).toThrow());
  it('uses separate business dates, excludes undeparted shipments and never mixes units', async () => {
    const { db, service } = setup();
    const base = {
      id: 'lot',
      lotCode: 'LOT',
      productId: 'product',
      product: { productName: 'Rau' },
      organization: { name: 'Farm' },
      unit: 'kg',
      harvest: { quantity: '100', harvestTime: new Date('2026-10-01') },
      shipment: {
        pickupTime: new Date('2026-10-02'),
        shippedQuantity: '100',
        receivedTime: new Date('2026-10-03'),
        receivedQuantity: '90',
        rejectedQuantity: '0',
      },
      quantityMovements: [
        { quantity: '10', traceEvent: { eventTime: new Date('2026-10-03') } },
      ],
    };
    db.lot.findMany.mockResolvedValue([
      base,
      {
        ...base,
        id: 'other',
        unit: 'box',
        shipment: { ...base.shipment, pickupTime: null },
      },
    ]);
    const result = await service.reports(
      {
        ...new HistoryQuery(),
        from: '2026-10-03',
        to: '2026-10-03T23:59:59Z',
        organizationId: 'outside',
      },
      actor,
    );
    expect(result.totals).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      harvested: 0,
      shipped: 0,
      received: 90,
      damaged: 10,
      rejected: 0,
    });
    expect(db.lot.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      farmOrgId: 'farm',
    });
  });
  it('checks access before marking an unknown or inaccessible notification', async () => {
    const { db, service } = setup();
    db.traceEvent.findFirst.mockResolvedValue(null);
    await expect(service.readNotification('missing', actor)).rejects.toThrow();
    expect(db.notificationRead.upsert).not.toHaveBeenCalled();
  });
  it('read state is scoped to the current user and mark-read is idempotent', async () => {
    const { db, service } = setup();
    db.traceEvent.findFirst.mockResolvedValue({ id: 'event' });
    await service.readNotification('event', actor);
    expect(db.notificationRead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_eventId: { userId: 'user', eventId: 'event' } },
      }),
    );
  });
  it('rechecks lot access before resolving a shipment link', async () => {
    const { db, service, access } = setup();
    db.traceEvent.findFirst.mockResolvedValue({
      lotId: 'lot',
      entityType: 'SHIPMENT',
    });
    expect(await service.notificationTarget('event', actor)).toEqual({
      href: '/lots/lot#shipment',
    });
    access.assertLotAccess.mockRejectedValue(new Error('Forbidden'));
    await expect(service.notificationTarget('event', actor)).rejects.toThrow(
      'Forbidden',
    );
  });
  it('paginates notifications and excludes another user read markers', async () => {
    const { db, service } = setup();
    db.notificationRead.findMany.mockResolvedValue([{ eventId: 'read' }]);
    db.traceEvent.findMany.mockResolvedValue([{ id: 'read' }, { id: 'new' }]);
    db.traceEvent.count.mockResolvedValueOnce(21).mockResolvedValueOnce(20);
    const result = await service.notifications(
      { ...new HistoryQuery(), page: 2 },
      actor,
    );
    expect(result.unread).toBe(20);
    expect(result.items.map((i) => i.isRead)).toEqual([true, false]);
    expect(db.traceEvent.findMany.mock.calls[0][0]).toMatchObject({
      skip: 20,
      take: 20,
    });
    expect(db.notificationRead.findMany.mock.calls[0][0].where).toEqual({
      userId: 'user',
    });
  });
});
describe('sensor history', () => {
  it('uses only matching units and prefers per-device backend thresholds', () => {
    const rules = [
      { sensorType: 'temperature', unit: 'C', min: 10, max: 30 },
      { sensorType: 'temperature', unit: 'C', min: 12, max: 20, deviceId: 'd' },
    ];
    expect(
      sensorAlert(
        { sensorType: 'temperature', unit: 'C', deviceId: 'd', value: 25 },
        rules,
      ).alert,
    ).toBe('HIGH');
    expect(
      sensorAlert(
        { sensorType: 'temperature', unit: 'F', deviceId: 'd', value: 25 },
        rules,
      ).alert,
    ).toBe('NOT_CONFIGURED');
    expect(
      sensorAlert(
        { sensorType: 'temperature', unit: 'C', deviceId: 'other', value: 10 },
        rules,
      ).alert,
    ).toBe('NORMAL');
  });
  it('does not invent thresholds for invalid configuration', () => {
    vi.stubEnv('SENSOR_THRESHOLDS_JSON', 'broken');
    expect(sensorThresholds()).toEqual([]);
  });
  it('caps selected harvest history at harvest time and scopes reads', async () => {
    const { db, service } = setup();
    db.harvestEvent.findFirst.mockResolvedValue({
      cycleId: 'cycle',
      harvestTime: new Date('2026-10-02'),
    });
    db.sensorReading.findMany.mockResolvedValue([]);
    db.sensorReading.count.mockResolvedValue(0);
    await service.sensorHistory(
      { ...new HistoryQuery(), harvestId: 'harvest', to: '2026-10-04' },
      actor,
    );
    expect(db.sensorReading.findMany.mock.calls[0][0].where).toMatchObject({
      cycle: { farmOrgId: 'farm' },
      cycleId: 'cycle',
      recordedAt: { lte: new Date('2026-10-02') },
    });
  });
});
describe('private and public media', () => {
  it('rejects spoofed file content without storing anything', async () => {
    const { db, service } = setup();
    await expect(
      service.upload({ targetType: 'LOT', targetId: 'lot' }, actor, {
        buffer: Buffer.from('<script>'),
        mimetype: 'image/png',
        originalname: 'fake.png',
        size: 8,
      }),
    ).rejects.toThrow();
    expect(db.mediaAttachment.create).not.toHaveBeenCalled();
  });
  it('stores actual image bytes privately and sanitizes names', async () => {
    const { db, service } = setup();
    const buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await service.upload({ targetType: 'LOT', targetId: 'lot' }, actor, {
      buffer,
      mimetype: 'image/png',
      originalname: '../photo.png',
      size: 8,
    });
    expect(db.mediaAttachment.create.mock.calls[0][0].data).toMatchObject({
      name: '.._photo.png',
      createdBy: 'user',
      content: new Uint8Array(buffer),
    });
    expect(
      db.mediaAttachment.create.mock.calls[0][0].data.isPublic,
    ).toBeUndefined();
  });
  it('forbids a transporter writing media even for a visible lot', async () => {
    const { service } = setup();
    await expect(
      service.authorizeMedia(
        { targetType: 'LOT', targetId: 'lot' },
        { ...actor, role: 'TRANSPORTER' },
        true,
      ),
    ).rejects.toThrow();
  });
  it('forbids farmers modifying shared product photos', async () => {
    const { db, service } = setup();
    db.product.findUnique.mockResolvedValue({ id: 'product' });
    await expect(
      service.authorizeMedia(
        { targetType: 'PRODUCT', targetId: 'product' },
        actor,
        true,
      ),
    ).rejects.toThrow();
  });
  it('only exposes public attachments from approved public certificates for the trace token', async () => {
    const { db, service } = setup();
    db.traceQr.findUnique.mockResolvedValue({
      lotId: 'lot',
      lot: {
        productId: 'product',
        certificates: [
          { id: 'ok', status: 'APPROVED', isPublic: true },
          { id: 'pending', status: 'PENDING', isPublic: true },
          { id: 'private', status: 'APPROVED', isPublic: false },
        ],
        harvest: { cycle: { certificates: [] } },
      },
    });
    db.mediaAttachment.findMany.mockResolvedValue([]);
    await service.publicMedia('token');
    const where = db.mediaAttachment.findMany.mock.calls[0][0].where;
    expect(where.isPublic).toBe(true);
    expect(where.OR[2]).toEqual({
      targetType: 'CERTIFICATE',
      targetId: { in: ['ok'] },
    });
    db.mediaAttachment.findFirst.mockResolvedValue(null);
    await expect(service.publicMedia('token', 'hidden')).rejects.toThrow();
  });
});
