import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import type {
  CreateShipmentDto,
  DamageShipmentDto,
  ReceiveShipmentDto,
  RejectShipmentDto,
  ShipmentTransitionDto,
} from './dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly trace: TraceService,
  ) {}

  list(actor: Actor) {
    const unrestricted = ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role);
    return this.prisma.shipment.findMany({
      where: unrestricted
        ? undefined
        : {
            OR: [
              { transporterOrgId: actor.organizationId ?? undefined },
              { retailerOrgId: actor.organizationId ?? undefined },
              { lot: { farmOrgId: actor.organizationId ?? undefined } },
            ],
          },
      include: {
        transporter: { select: { id: true, name: true, type: true } },
        retailer: { select: { id: true, name: true, type: true } },
        lot: {
          include: {
            product: { select: { id: true, productName: true } },
            organization: { select: { id: true, name: true, type: true } },
          },
        },
        telemetryDigest: true,
        _count: { select: { telemetry: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, actor: Actor) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        transporter: true,
        retailer: true,
        lot: { include: { product: true, organization: true } },
        telemetry: { orderBy: { recordedAt: 'desc' }, take: 100 },
        telemetryDigest: true,
        trackingBindings: { include: { device: true } },
      },
    });
    if (!shipment)
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    if (
      !['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role) &&
      (!actor.organizationId ||
        ![
          shipment.lot.farmOrgId,
          shipment.transporterOrgId,
          shipment.retailerOrgId,
        ].includes(actor.organizationId))
    )
      throw new ForbiddenException(
        'Tổ chức hiện tại không có quyền xem chuyến hàng',
      );
    return shipment;
  }

  async create(input: CreateShipmentDto, actor: Actor) {
    const lot = await this.access.assertLotAccess(actor, input.lotId);
    const fullLot = await this.prisma.lot.findUnique({ where: { id: lot.id } });
    if (!fullLot || fullLot.currentState !== 'HARVESTED')
      throw new ConflictException('Lô hàng chưa sẵn sàng vận chuyển');
    const [transporter, retailer] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: input.transporterOrgId },
      }),
      this.prisma.organization.findUnique({
        where: { id: input.retailerOrgId },
      }),
    ]);
    if (
      !transporter ||
      transporter.type !== 'TRANSPORTER' ||
      transporter.status !== 'ACTIVE'
    ) {
      throw new UnprocessableEntityException('Đơn vị vận chuyển không hợp lệ');
    }
    if (
      !retailer ||
      retailer.type !== 'RETAILER' ||
      retailer.status !== 'ACTIVE'
    ) {
      throw new UnprocessableEntityException('Đơn vị bán lẻ không hợp lệ');
    }
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.create({
        data: {
          lotId: fullLot.id,
          transporterOrgId: input.transporterOrgId,
          retailerOrgId: input.retailerOrgId,
          origin: input.origin,
          destination: input.destination,
          shippedQuantity: fullLot.availableQuantity,
          unit: fullLot.unit,
          plannedPickupTime: input.plannedPickupTime
            ? new Date(input.plannedPickupTime)
            : undefined,
          expectedArrival: input.expectedArrivalTime
            ? new Date(input.expectedArrivalTime)
            : undefined,
          vehicleRef: input.vehicleRef,
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: shipment.id,
        lotId: shipment.lotId,
        eventType: 'SHIPMENT_CREATED',
        actor,
        businessData: {
          transporterOrgId: shipment.transporterOrgId,
          retailerOrgId: shipment.retailerOrgId,
          quantity: shipment.shippedQuantity.toString(),
          unit: shipment.unit,
        },
      });
      return shipment;
    });
  }

  async start(id: string, input: ShipmentTransitionDto, actor: Actor) {
    const shipment = await this.getAndAssertOrg(id, actor, 'transporter');
    return this.transition(
      shipment.id,
      shipment.lotId,
      input,
      'CREATED',
      'IN_TRANSIT',
      'HARVESTED',
      'IN_TRANSPORT',
      'SHIPMENT_STARTED',
      actor,
      { pickupTime: this.time(input) },
    );
  }

  async arrive(id: string, input: ShipmentTransitionDto, actor: Actor) {
    const shipment = await this.getAndAssertOrg(id, actor, 'transporter');
    return this.transition(
      shipment.id,
      shipment.lotId,
      input,
      'IN_TRANSIT',
      'ARRIVED',
      'IN_TRANSPORT',
      'ARRIVED',
      'SHIPMENT_ARRIVED',
      actor,
      { arrivalTime: this.time(input) },
    );
  }

  async receive(id: string, input: ReceiveShipmentDto, actor: Actor) {
    await this.getAndAssertOrg(id, actor, 'retailer');

    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUniqueOrThrow({ where: { id } });
      const lot = await tx.lot.findUniqueOrThrow({
        where: { id: shipment.lotId },
      });

      const received = new Prisma.Decimal(input.receivedQuantity);
      const newlyDamaged = new Prisma.Decimal(input.damagedQuantity ?? 0);
      const totalDamaged = shipment.damagedQuantity.plus(newlyDamaged);

      if (!received.plus(newlyDamaged).equals(lot.availableQuantity)) {
        throw new UnprocessableEntityException(
          'Số lượng nhận + hư hỏng mới phải bằng số lượng lô còn lại',
        );
      }
      if (!received.plus(totalDamaged).equals(shipment.shippedQuantity)) {
        throw new UnprocessableEntityException(
          'Tổng số lượng nhận và hư hỏng không khớp số lượng đã gửi',
        );
      }

      const updatedShipment = await tx.shipment.updateMany({
        where: { id, version: input.version, status: 'ARRIVED' },
        data: {
          status: 'DELIVERED',
          version: { increment: 1 },
          receivedTime: this.time(input),
          receivedQuantity: received,
          damagedQuantity: totalDamaged,
          rejectedQuantity: new Prisma.Decimal(0),
        },
      });
      const updatedLot = await tx.lot.updateMany({
        where: {
          id: lot.id,
          version: input.lotVersion,
          currentState: 'ARRIVED',
        },
        data: {
          currentState: 'RETAIL_RECEIVED',
          availableQuantity: received,
          version: { increment: 1 },
        },
      });
      if (updatedShipment.count !== 1 || updatedLot.count !== 1) {
        throw new ConflictException('Version hoặc trạng thái đã thay đổi');
      }

      const event = await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: id,
        lotId: lot.id,
        eventType: 'SHIPMENT_RECEIVED',
        actor,
        businessData: {
          receivedQuantity: received.toString(),
          newlyDamagedQuantity: newlyDamaged.toString(),
          totalDamagedQuantity: totalDamaged.toString(),
          rejectedQuantity: '0',
          note: input.note ?? null,
        },
      });

      if (newlyDamaged.greaterThan(0)) {
        await tx.quantityMovement.create({
          data: {
            lotId: lot.id,
            eventId: event.id,
            type: 'DAMAGE_OUT',
            quantity: newlyDamaged,
            unit: lot.unit,
            beforeQty: lot.availableQuantity,
            delta: newlyDamaged.negated(),
            afterQty: received,
          },
        });
      }

      return tx.shipment.findUniqueOrThrow({ where: { id } });
    });
  }

  async reject(id: string, input: RejectShipmentDto, actor: Actor) {
    await this.getAndAssertOrg(id, actor, 'retailer');

    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUniqueOrThrow({ where: { id } });
      const lot = await tx.lot.findUniqueOrThrow({
        where: { id: shipment.lotId },
      });
      const rejected = lot.availableQuantity;

      if (!rejected.plus(shipment.damagedQuantity).equals(shipment.shippedQuantity)) {
        throw new UnprocessableEntityException(
          'Số lượng từ chối và hư hỏng không khớp số lượng đã gửi',
        );
      }

      const updatedShipment = await tx.shipment.updateMany({
        where: { id, version: input.version, status: 'ARRIVED' },
        data: {
          status: 'REJECTED',
          version: { increment: 1 },
          receivedTime: this.time(input),
          receivedQuantity: null,
          rejectedQuantity: rejected,
          rejectReason: input.reason,
        },
      });
      const updatedLot = await tx.lot.updateMany({
        where: {
          id: lot.id,
          version: input.lotVersion,
          currentState: 'ARRIVED',
        },
        data: { currentState: 'REJECTED', version: { increment: 1 } },
      });
      if (updatedShipment.count !== 1 || updatedLot.count !== 1) {
        throw new ConflictException('Version hoặc trạng thái đã thay đổi');
      }

      await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: id,
        lotId: lot.id,
        eventType: 'SHIPMENT_REJECTED',
        actor,
        businessData: {
          rejectedQuantity: rejected.toString(),
          damagedQuantity: shipment.damagedQuantity.toString(),
          reason: input.reason,
        },
      });

      return tx.shipment.findUniqueOrThrow({ where: { id } });
    });
  }

  async damage(id: string, input: DamageShipmentDto, actor: Actor) {
    const shipment = await this.getAndAssertCurrentCustodian(id, actor);

    return this.prisma.$transaction(async (tx) => {
      const lot = await tx.lot.findUniqueOrThrow({
        where: { id: shipment.lotId },
      });
      const quantity = new Prisma.Decimal(input.quantity);

      if (quantity.greaterThan(lot.availableQuantity)) {
        throw new UnprocessableEntityException(
          'Số lượng hư hỏng vượt số lượng còn lại',
        );
      }

      const after = lot.availableQuantity.minus(quantity);
      const totalDamaged = shipment.damagedQuantity.plus(quantity);
      const fullDamage = after.equals(0);
      const lotState = fullDamage ? 'DAMAGED' : lot.currentState;
      const shipmentState = fullDamage ? 'FAILED' : shipment.status;

      const updatedShipment = await tx.shipment.updateMany({
        where: { id, version: input.version, status: shipment.status },
        data: {
          status: shipmentState,
          damagedQuantity: totalDamaged,
          version: { increment: 1 },
        },
      });
      const updatedLot = await tx.lot.updateMany({
        where: {
          id: lot.id,
          version: input.lotVersion,
          currentState: lot.currentState,
        },
        data: {
          currentState: lotState,
          availableQuantity: after,
          version: { increment: 1 },
        },
      });
      if (updatedShipment.count !== 1 || updatedLot.count !== 1) {
        throw new ConflictException('Version hoặc trạng thái đã thay đổi');
      }

      const event = await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: id,
        lotId: lot.id,
        eventType: 'SHIPMENT_DAMAGE_RECORDED',
        actor,
        businessData: {
          quantity: quantity.toString(),
          totalDamagedQuantity: totalDamaged.toString(),
          unit: lot.unit,
          reason: input.reason,
          fullDamage,
        },
      });
      await tx.quantityMovement.create({
        data: {
          lotId: lot.id,
          eventId: event.id,
          type: 'DAMAGE_OUT',
          quantity,
          unit: lot.unit,
          beforeQty: lot.availableQuantity,
          delta: quantity.negated(),
          afterQty: after,
        },
      });

      return {
        shipmentStatus: shipmentState,
        lotState,
        availableQuantity: after,
        damagedQuantity: totalDamaged,
      };
    });
  }

  private async transition(
    shipmentId: string,
    lotId: string,
    input: ShipmentTransitionDto,
    fromShipment: 'CREATED' | 'IN_TRANSIT',
    toShipment: 'IN_TRANSIT' | 'ARRIVED',
    fromLot: 'HARVESTED' | 'IN_TRANSPORT',
    toLot: 'IN_TRANSPORT' | 'ARRIVED',
    eventType: string,
    actor: Actor,
    data: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.shipment.updateMany({
        where: { id: shipmentId, version: input.version, status: fromShipment },
        data: { status: toShipment, version: { increment: 1 }, ...data },
      });
      const l = await tx.lot.updateMany({
        where: { id: lotId, version: input.lotVersion, currentState: fromLot },
        data: { currentState: toLot, version: { increment: 1 } },
      });
      if (s.count !== 1 || l.count !== 1)
        throw new ConflictException('Version hoặc trạng thái đã thay đổi');
      await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        lotId,
        eventType,
        actor,
        eventTime: this.time(input),
        businessData: {},
      });
      return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    });
  }

  private async getAndAssertOrg(
    id: string,
    actor: Actor,
    party: 'transporter' | 'retailer',
  ) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment)
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    const expected =
      party === 'transporter'
        ? shipment.transporterOrgId
        : shipment.retailerOrgId;
    if (actor.role !== 'SYSTEM_ADMIN' && actor.organizationId !== expected)
      throw new ForbiddenException(
        'Tổ chức hiện tại không có quyền quản lý chuyến hàng',
      );
    return shipment;
  }
  private async getAndAssertCurrentCustodian(id: string, actor: Actor) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
    });
    if (!shipment) {
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    }

    if (!['IN_TRANSIT', 'ARRIVED'].includes(shipment.status)) {
      throw new ConflictException(
        'Chỉ ghi nhận hư hỏng sau khi lô đã được bàn giao vận chuyển',
      );
    }

    const expectedOrganizationId =
      shipment.status === 'IN_TRANSIT'
        ? shipment.transporterOrgId
        : shipment.retailerOrgId;

    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      actor.organizationId !== expectedOrganizationId
    ) {
      throw new ForbiddenException(
        'Tổ chức hiện tại không đang quản lý lô hàng',
      );
    }

    return shipment;
  }

  private time(input: ShipmentTransitionDto): Date {
    return input.occurredAt ? new Date(input.occurredAt) : new Date();
  }
}
