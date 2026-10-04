import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import type { HistoryQuery, MediaTarget } from './dto.js';

const NONE = '00000000-0000-0000-0000-000000000000';
export const mediaSelect = {
  id: true,
  name: true,
  mime: true,
  size: true,
  isPublic: true,
  targetType: true,
  targetId: true,
  createdAt: true,
} as const;
export function lotScope(actor: Actor): Prisma.LotWhereInput {
  if (['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)) return {};
  const id = actor.organizationId ?? NONE;
  if (actor.role === 'FARM_STAFF') return { farmOrgId: id };
  if (actor.role === 'TRANSPORTER')
    return { shipment: { transporterOrgId: id } };
  if (actor.role === 'RETAILER') return { shipment: { retailerOrgId: id } };
  return { id: NONE };
}
export function timeRange(q: HistoryQuery) {
  const from = q.from ? new Date(q.from) : undefined;
  const to = q.to ? new Date(q.to) : undefined;
  if (from && to && from > to)
    throw new BadRequestException('Ngày bắt đầu phải trước ngày kết thúc');
  return { gte: from, lte: to };
}

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async reports(q: HistoryQuery, actor: Actor) {
    const range = timeRange(q);
    const lots = await this.db.lot.findMany({
      where: {
        AND: [
          lotScope(actor),
          { productId: q.productId },
          q.organizationId
            ? {
                OR: [
                  { farmOrgId: q.organizationId },
                  { shipment: { transporterOrgId: q.organizationId } },
                  { shipment: { retailerOrgId: q.organizationId } },
                ],
              }
            : {},
        ],
      },
      include: {
        product: true,
        organization: true,
        harvest: true,
        shipment: true,
        quantityMovements: {
          where: { type: 'DAMAGE_OUT' },
          include: { traceEvent: { select: { eventTime: true } } },
        },
      },
      orderBy: { lotCode: 'asc' },
    });
    const inRange = (date: Date | null) =>
      !!date &&
      (!range.gte || date >= range.gte) &&
      (!range.lte || date <= range.lte);
    const rows = lots
      .map((lot) => ({
        lotId: lot.id,
        lotCode: lot.lotCode,
        productId: lot.productId,
        product: lot.product.productName,
        organization: lot.organization.name,
        unit: lot.unit,
        harvested: inRange(lot.harvest.harvestTime)
          ? Number(lot.harvest.quantity)
          : 0,
        shipped: inRange(lot.shipment?.pickupTime ?? null)
          ? Number(lot.shipment?.shippedQuantity ?? 0)
          : 0,
        received: inRange(lot.shipment?.receivedTime ?? null)
          ? Number(lot.shipment?.receivedQuantity ?? 0)
          : 0,
        rejected: inRange(lot.shipment?.receivedTime ?? null)
          ? Number(lot.shipment?.rejectedQuantity ?? 0)
          : 0,
        damaged: lot.quantityMovements
          .filter((m) => inRange(m.traceEvent.eventTime))
          .reduce((sum, m) => sum.add(m.quantity), new Prisma.Decimal(0)).toNumber(),
      }))
      .filter(
        (r) =>
          r.harvested || r.shipped || r.received || r.rejected || r.damaged,
      );
    const totals = [...new Set(rows.map((r) => r.unit))].map((unit) => {
      const group = rows.filter((r) => r.unit === unit);
      return {
        unit,
        harvested: group.reduce((s, r) => s.add(r.harvested), new Prisma.Decimal(0)).toNumber(),
        shipped: group.reduce((s, r) => s.add(r.shipped), new Prisma.Decimal(0)).toNumber(),
        received: group.reduce((s, r) => s.add(r.received), new Prisma.Decimal(0)).toNumber(),
        damaged: group.reduce((s, r) => s.add(r.damaged), new Prisma.Decimal(0)).toNumber(),
        rejected: group.reduce((s, r) => s.add(r.rejected), new Prisma.Decimal(0)).toNumber(),
      };
    });
    return { rows, totals };
  }

  async reportOptions(actor: Actor) {
    const lots = await this.db.lot.findMany({
      where: lotScope(actor),
      include: {
        product: true,
        organization: true,
        shipment: { include: { transporter: true, retailer: true } },
      },
    });
    return {
      products: [
        ...new Map(
          lots.map((l) => [
            l.productId,
            { id: l.productId, name: l.product.productName },
          ]),
        ).values(),
      ],
      organizations: [
        ...new Map(
          lots.flatMap((l) =>
            [l.organization, l.shipment?.transporter, l.shipment?.retailer]
              .filter((o) => !!o)
              .map((o) => [o.id, { id: o.id, name: o.name }] as const),
          ),
        ).values(),
      ],
    };
  }

  private eventScope(actor: Actor): Prisma.TraceEventWhereInput {
    if (['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)) return {};
    return {
      OR: [
        { lot: lotScope(actor) },
        ...(actor.role === 'FARM_STAFF'
          ? [{ cycle: { farmOrgId: actor.organizationId ?? NONE } }]
          : []),
      ],
    };
  }
  async notifications(q: HistoryQuery, actor: Actor) {
    const where = this.eventScope(actor);
    return this.db.$transaction(
      async (tx) => {
        const read = await tx.notificationRead.findMany({
          where: { userId: actor.sub! },
          select: { eventId: true },
        });
        const readIds = read.map((r) => r.eventId);
        const [events, total, unread] = await Promise.all([
          tx.traceEvent.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 20,
            skip: (q.page - 1) * 20,
            select: {
              id: true,
              eventType: true,
              entityType: true,
              entityId: true,
              lotId: true,
              cycleId: true,
              createdAt: true,
            },
          }),
          tx.traceEvent.count({ where }),
          tx.traceEvent.count({
            where: { AND: [where, { id: { notIn: readIds } }] },
          }),
        ]);
        return {
          items: events.map((e) => ({ ...e, isRead: readIds.includes(e.id) })),
          total,
          unread,
          page: q.page,
          pageSize: 20,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async readNotification(id: string, actor: Actor) {
    const event = await this.db.traceEvent.findFirst({
      where: { AND: [{ id }, this.eventScope(actor)] },
    });
    if (!event)
      throw new NotFoundException(
        'Thông báo không tồn tại hoặc bạn không còn quyền xem',
      );
    await this.db.notificationRead.upsert({
      where: { userId_eventId: { userId: actor.sub!, eventId: id } },
      create: { userId: actor.sub!, eventId: id },
      update: {},
    });
    return { success: true };
  }
  async notificationTarget(id: string, actor: Actor) {
    const event = await this.db.traceEvent.findFirst({
      where: { AND: [{ id }, this.eventScope(actor)] },
    });
    if (!event)
      throw new NotFoundException(
        'Đối tượng không tồn tại hoặc bạn không còn quyền xem',
      );
    if (event.entityType === 'CERTIFICATE') {
      await this.authorizeMedia({targetType:'CERTIFICATE',targetId:event.entityId},actor);
      return {href:`/documents?targetType=CERTIFICATE&targetId=${event.entityId}`};
    }
    if (event.entityType === 'SHIPMENT') await this.access.assertShipmentAccess(actor,event.entityId);
    if (event.lotId) {
      await this.access.assertLotAccess(actor, event.lotId);
      return {
        href: `/lots/${event.lotId}${event.entityType === 'SHIPMENT' ? '#shipment' : ''}`,
      };
    }
    if (event.cycleId)
      return { href: `/production-cycles?cycleId=${event.cycleId}` };
    throw new NotFoundException('Thông báo chưa có đối tượng có thể mở');
  }

  async sensorHistory(q: HistoryQuery, actor: Actor) {
    const range = timeRange(q);
    let cycleId = q.cycleId;
    if (q.harvestId) {
      const harvest = await this.db.harvestEvent.findFirst({
        where: { id: q.harvestId, lot: lotScope(actor) },
      });
      if (!harvest)
        throw new NotFoundException(
          'Không tìm thấy lần thu hoạch trong phạm vi truy cập',
        );
      if (cycleId && cycleId !== harvest.cycleId)
        throw new BadRequestException('Lần thu hoạch không thuộc vụ đã chọn');
      cycleId = harvest.cycleId;
      if (!range.lte || range.lte > harvest.harvestTime)
        range.lte = harvest.harvestTime;
    }
    const scope: Prisma.ProductionCycleWhereInput = [
      'SYSTEM_ADMIN',
      'AUDITOR',
    ].includes(actor.role)
      ? {}
      : actor.role === 'FARM_STAFF'
        ? { farmOrgId: actor.organizationId ?? NONE }
        : { harvestEvents: { some: { lot: lotScope(actor) } } };
    const where: Prisma.SensorReadingWhereInput = {
      cycle: scope,
      cycleId,
      deviceId: q.deviceId,
      recordedAt: range,
    };
    const [items, total] = await this.db.$transaction([
      this.db.sensorReading.findMany({
        where,
        include: {
          device: { select: { name: true, deviceCode: true } },
          cycle: { select: { cycleCode: true } },
        },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 100,
        skip: (q.page - 1) * 100,
      }),
      this.db.sensorReading.count({ where }),
    ]);
    const rules = sensorThresholds();
    return {
      items: items.map((item) => ({ ...item, ...sensorAlert(item, rules) })),
      total,
      page: q.page,
      pageSize: 100,
      thresholdStatus: rules.length ? 'CONFIGURED' : 'NOT_CONFIGURED',
      thresholdMessage: rules.length
        ? 'Cảnh báo do backend tính theo ngưỡng đang cấu hình, đúng loại cảm biến và đơn vị. Bản ghi không có ngưỡng được ghi rõ.'
        : 'Chưa có ngưỡng cảm biến được cấu hình; chưa thể kết luận vượt ngưỡng. Liên hệ quản trị viên để thiết lập.',
    };
  }

  async sensorOptions(actor: Actor) {
    const scope: Prisma.ProductionCycleWhereInput = [
      'SYSTEM_ADMIN',
      'AUDITOR',
    ].includes(actor.role)
      ? {}
      : actor.role === 'FARM_STAFF'
        ? { farmOrgId: actor.organizationId ?? NONE }
        : { harvestEvents: { some: { lot: lotScope(actor) } } };
    return this.db.iotDevice.findMany({
      where: { sensorReadings: { some: { cycle: scope } } },
      select: { id: true, name: true, deviceCode: true },
      orderBy: { name: 'asc' },
    });
  }

  async authorizeMedia(target: MediaTarget, actor: Actor, write = false) {
    if (write && !['SYSTEM_ADMIN', 'FARM_STAFF'].includes(actor.role))
      throw new ForbiddenException(
        'Chỉ quản trị viên hoặc nông trại sở hữu được quản lý tài liệu',
      );
    if (target.targetType === 'PRODUCT') {
      const product = await this.db.product.findUnique({
        where: { id: target.targetId },
      });
      if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
      if (write && actor.role !== 'SYSTEM_ADMIN')
        throw new ForbiddenException(
          'Chỉ quản trị viên được sửa ảnh sản phẩm dùng chung',
        );
      if (
        !write &&
        !['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role) &&
        !(await this.db.lot.findFirst({
          where: { AND: [lotScope(actor), { productId: target.targetId }] },
        }))
      )
        throw new ForbiddenException('Không có quyền xem sản phẩm');
      return;
    }
    let lotId = target.targetId;
    if (target.targetType === 'CERTIFICATE') {
      const cert = await this.db.certificate.findUnique({
        where: { id: target.targetId },
      });
      if (!cert) throw new NotFoundException('Không tìm thấy chứng nhận');
      if (!cert.lotId) {
        if (!cert.cycleId) throw new ForbiddenException();
        if (actor.role === 'AUDITOR' && !write) return;
        await this.access.assertProductionCycleAccess(actor, cert.cycleId);
        return;
      }
      lotId = cert.lotId;
    }
    const lot = await this.access.assertLotAccess(actor, lotId);
    if (
      write &&
      actor.role !== 'SYSTEM_ADMIN' &&
      lot.farmOrgId !== actor.organizationId
    )
      throw new ForbiddenException('Chỉ nông trại sở hữu được sửa tài liệu');
  }
  async mediaList(target: MediaTarget, actor: Actor) {
    await this.authorizeMedia(target, actor);
    return this.db.mediaAttachment.findMany({
      where: target,
      select: mediaSelect,
      orderBy: { createdAt: 'desc' },
    });
  }
  async upload(
    target: MediaTarget,
    actor: Actor,
    file?: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
  ) {
    await this.authorizeMedia(target, actor, true);
    if (!file || file.size === 0 || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Chọn tệp từ 1 byte đến 5 MB');
    const b = file.buffer;
    const mime = b
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : b[0] === 255 && b[1] === 216 && b[2] === 255
        ? 'image/jpeg'
        : b.subarray(0, 5).toString() === '%PDF-'
          ? 'application/pdf'
          : b.subarray(0, 4).toString() === 'RIFF' &&
              b.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : null;
    if (!mime || mime !== file.mimetype)
      throw new BadRequestException(
        'Chỉ hỗ trợ nội dung PNG, JPEG, WebP và PDF đúng định dạng',
      );
    const name = Array.from(file.originalname)
      .map((c) => (c.charCodeAt(0) < 32 || c === '/' || c === '\\' ? '_' : c))
      .join('')
      .slice(0, 255);
    return this.db.mediaAttachment.create({
      data: {
        ...target,
        name,
        mime,
        size: file.size,
        content: new Uint8Array(b),
        createdBy: actor.sub!,
      },
      select: mediaSelect,
    });
  }
  async mediaById(id: string, actor: Actor, write = false) {
    const file = await this.db.mediaAttachment.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('Tài liệu không còn tồn tại');
    await this.authorizeMedia(file, actor, write);
    return file;
  }
  async visibility(id: string, isPublic: boolean, actor: Actor) {
    await this.mediaById(id, actor, true);
    return this.db.mediaAttachment.update({
      where: { id },
      data: { isPublic },
      select: mediaSelect,
    });
  }
  async removeMedia(id: string, actor: Actor) {
    await this.mediaById(id, actor, true);
    await this.db.mediaAttachment.delete({ where: { id } });
    return { deleted: true };
  }
  async publicMedia(token: string, id?: string) {
    const qr = await this.db.traceQr.findUnique({
      where: { traceToken: token },
      include: {
        lot: {
          include: {
            certificates: true,
            harvest: {
              include: { cycle: { include: { certificates: true } } },
            },
          },
        },
      },
    });
    if (!qr) throw new NotFoundException('Không tìm thấy mã truy xuất');
    const certIds = [
      ...qr.lot.certificates,
      ...qr.lot.harvest.cycle.certificates,
    ]
      .filter((c) => c.isPublic && c.status === 'APPROVED')
      .map((c) => c.id);
    const where: Prisma.MediaAttachmentWhereInput = {
      id,
      isPublic: true,
      OR: [
        { targetType: 'LOT', targetId: qr.lotId },
        { targetType: 'PRODUCT', targetId: qr.lot.productId },
        { targetType: 'CERTIFICATE', targetId: { in: certIds } },
      ],
    };
    if (id) {
      const file = await this.db.mediaAttachment.findFirst({ where });
      if (!file) throw new NotFoundException('Tài liệu không được công khai');
      return file;
    }
    return this.db.mediaAttachment.findMany({
      where,
      select: mediaSelect,
      orderBy: { createdAt: 'desc' },
    });
  }
}

type Threshold = {
  sensorType: string;
  unit: string;
  min: number;
  max: number;
  deviceId?: string;
};
export function sensorThresholds(): Threshold[] {
  try {
    const rules: unknown = JSON.parse(
      process.env.SENSOR_THRESHOLDS_JSON ?? '[]',
    );
    if (!Array.isArray(rules)) return [];
    return rules.filter(
      (r): r is Threshold =>
        !!r &&
        typeof r.sensorType === 'string' &&
        typeof r.unit === 'string' &&
        typeof r.min === 'number' &&
        Number.isFinite(r.min) &&
        typeof r.max === 'number' &&
        Number.isFinite(r.max) &&
        r.min <= r.max &&
        (!r.deviceId || typeof r.deviceId === 'string'),
    );
  } catch {
    return [];
  }
}
export function sensorAlert(
  item: { sensorType: string; unit: string; deviceId: string; value: unknown },
  rules: Threshold[],
) {
  const candidates = rules.filter(
    (r) => r.sensorType === item.sensorType && r.unit === item.unit,
  );
  const threshold =
    candidates.find((r) => r.deviceId === item.deviceId) ??
    candidates.find((r) => !r.deviceId) ??
    null;
  const value = Number(item.value);
  return {
    threshold,
    alert: threshold
      ? value < threshold.min
        ? 'LOW'
        : value > threshold.max
          ? 'HIGH'
          : 'NORMAL'
      : 'NOT_CONFIGURED',
  };
}
