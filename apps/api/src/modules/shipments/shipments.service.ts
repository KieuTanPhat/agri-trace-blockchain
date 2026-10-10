import {
  assertBusinessActor,
  FARM_WRITE_ROLES,
  TRANSPORT_WRITE_ROLES,
  RETAIL_WRITE_ROLES,
  CUSTODY_WRITE_ROLES,
} from '../auth/business-write.policy.js';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  commandTransaction,
  lockAggregate,
} from '../../common/idempotency/command-transaction.js';
import { assertQuantityReconciled, quantity } from '../../common/quantity.js';
import { Prisma } from '../../generated/prisma/client.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { assignedFarmWhere } from '../auth/compliance-scope.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import type {
  CreateShipmentDto,
  DamageShipmentDto,
  ReceiveShipmentDto,
  RejectShipmentDto,
  ShipmentTransitionDto,
} from './dto.js';

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
        : actor.role === 'COMPLIANCE_REVIEWER'
          ? { lot: { harvest: { cycle: { farm: assignedFarmWhere(actor) } } } }
          : {
              OR: [
                {
                  transporterOrgId:
                    actor.organizationId ??
                    '00000000-0000-0000-0000-000000000000',
                },
                {
                  retailerOrgId:
                    actor.organizationId ??
                    '00000000-0000-0000-0000-000000000000',
                },
                {
                  lot: {
                    farmOrgId:
                      actor.organizationId ??
                      '00000000-0000-0000-0000-000000000000',
                  },
                },
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
    if (actor.role === 'COMPLIANCE_REVIEWER')
      await this.access.assertShipmentAccess(actor, id);
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
      !['SYSTEM_ADMIN', 'AUDITOR', 'COMPLIANCE_REVIEWER'].includes(
        actor.role,
      ) &&
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
    return {
      ...shipment,
      telemetry: shipment.telemetry.map((reading) => ({
        ...reading,
        deviceSequence: reading.deviceSequence?.toString() ?? null,
      })),
    };
  }

  async create(input: CreateShipmentDto, actor: Actor) {
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    const lot = await this.access.assertLotAccess(actor, input.lotId);
    if (lot.farmOrgId !== actor.organizationId)
      throw new ForbiddenException(
        'Lô không thuộc tổ chức của người tạo chuyến',
      );
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', lot.id);
      const fullLot = await tx.lot.findUnique({ where: { id: lot.id } });
      if (!fullLot || fullLot.currentState !== 'HARVESTED')
        throw new ConflictException('Lô hàng chưa sẵn sàng vận chuyển');
      const [transporter, retailer] = await Promise.all([
        tx.organization.findUnique({
          where: { id: input.transporterOrgId },
        }),
        tx.organization.findUnique({
          where: { id: input.retailerOrgId },
        }),
      ]);
      if (
        !transporter ||
        transporter.type !== 'TRANSPORTER' ||
        transporter.status !== 'ACTIVE'
      ) {
        throw new UnprocessableEntityException(
          'Đơn vị vận chuyển không hợp lệ',
        );
      }
      if (
        !retailer ||
        retailer.type !== 'RETAILER' ||
        retailer.status !== 'ACTIVE'
      ) {
        throw new UnprocessableEntityException('Đơn vị bán lẻ không hợp lệ');
      }
      if (
        !fullLot.availableQuantity.greaterThan(0) ||
        (await tx.shipment.findUnique({ where: { lotId: lot.id } }))
      )
        throw new ConflictException(
          'Lô đã có chuyến hàng hoặc không còn lượng khả dụng',
        );
      await assertQuantityReconciled(tx, fullLot);
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
    const shipment = await this.getAndAssertOrg(id, actor, 'retailer');
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', shipment.lotId);
      const lot = await tx.lot.findUniqueOrThrow({
        where: { id: shipment.lotId },
      });
      await assertQuantityReconciled(tx, lot);
      const received = quantity(input.receivedQuantity);
      const damaged = quantity(input.damagedQuantity ?? 0, true);
      if (!received.add(damaged).equals(lot.availableQuantity)) {
        throw new UnprocessableEntityException(
          'Số lượng nhận + hư hỏng phải bằng số lượng lô còn lại',
        );
      }
      const s = await tx.shipment.updateMany({
        where: { id, version: input.version, status: 'ARRIVED' },
        data: {
          status: 'DELIVERED',
          version: { increment: 1 },
          receivedTime: this.time(input),
          receivedQuantity: received,
          rejectedQuantity: 0,
        },
      });
      const l = await tx.lot.updateMany({
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
      if (s.count !== 1 || l.count !== 1)
        throw new ConflictException('Version hoặc trạng thái đã thay đổi');
      const event = await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: id,
        lotId: lot.id,
        eventType: 'SHIPMENT_RECEIVED',
        actor,
        businessData: {
          receivedQuantity: received.toString(),
          damagedQuantity: damaged.toString(),
          note: input.note ?? null,
        },
      });
      if (damaged.greaterThan(0))
        await tx.quantityMovement.create({
          data: {
            lotId: lot.id,
            eventId: event.id,
            type: 'DAMAGE_OUT',
            quantity: damaged,
            unit: lot.unit,
            beforeQty: lot.availableQuantity,
            delta: damaged.negated(),
            afterQty: received,
          },
        });
      return tx.shipment.findUniqueOrThrow({ where: { id } });
    });
  }

  async reject(id: string, input: RejectShipmentDto, actor: Actor) {
    const shipment = await this.getAndAssertOrg(id, actor, 'retailer');
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', shipment.lotId);
      const lot = await tx.lot.findUniqueOrThrow({
        where: { id: shipment.lotId },
      });
      const s = await tx.shipment.updateMany({
        where: { id, version: input.version, status: 'ARRIVED' },
        data: {
          status: 'REJECTED',
          version: { increment: 1 },
          receivedTime: this.time(input),
          rejectedQuantity: lot.availableQuantity,
          rejectReason: input.reason,
        },
      });
      const l = await tx.lot.updateMany({
        where: {
          id: shipment.lotId,
          version: input.lotVersion,
          currentState: 'ARRIVED',
        },
        data: { currentState: 'REJECTED', version: { increment: 1 } },
      });
      if (s.count !== 1 || l.count !== 1)
        throw new ConflictException('Version hoặc trạng thái đã thay đổi');
      await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: id,
        lotId: shipment.lotId,
        eventType: 'SHIPMENT_REJECTED',
        actor,
        businessData: { reason: input.reason },
      });
      return tx.shipment.findUniqueOrThrow({ where: { id } });
    });
  }

  async damage(id: string, input: DamageShipmentDto, actor: Actor) {
    const shipment = await this.getAndAssertCurrentCustodian(id, actor);
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', shipment.lotId);
      const currentShipment = await this.getAndAssertCurrentCustodian(
        id,
        actor,
        tx,
      );
      const lot = await tx.lot.findUniqueOrThrow({
        where: { id: shipment.lotId },
      });
      await assertQuantityReconciled(tx, lot);
      const damaged = quantity(input.quantity);
      if (damaged.greaterThan(lot.availableQuantity))
        throw new UnprocessableEntityException(
          'Số lượng hư hỏng vượt số lượng còn lại',
        );
      const expectedLotState =
        currentShipment.status === 'IN_TRANSIT' ? 'IN_TRANSPORT' : 'ARRIVED';
      if (lot.currentState !== expectedLotState)
        throw new ConflictException('Trạng thái lô không khớp chuyến hàng');
      const after = lot.availableQuantity.sub(damaged);
      const lotState = after.isZero() ? 'DAMAGED' : lot.currentState;
      const shipmentState = after.isZero() ? 'FAILED' : currentShipment.status;
      const s = await tx.shipment.updateMany({
        where: { id, version: input.version, status: currentShipment.status },
        data: {
          status: shipmentState,
          version: { increment: 1 },
          rejectReason: input.reason,
        },
      });
      const l = await tx.lot.updateMany({
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
      if (s.count !== 1 || l.count !== 1)
        throw new ConflictException('Version hoặc trạng thái đã thay đổi');
      const event = await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: id,
        lotId: lot.id,
        eventType: 'SHIPMENT_DAMAGE_RECORDED',
        actor,
        businessData: {
          quantity: damaged.toString(),
          unit: lot.unit,
          reason: input.reason,
          fullDamage: after.isZero(),
          evidenceRef: input.evidenceRef ?? null,
          custodianOrganizationId: actor.organizationId,
          shipmentStateBefore: currentShipment.status,
        },
      });
      await tx.quantityMovement.create({
        data: {
          lotId: lot.id,
          eventId: event.id,
          type: 'DAMAGE_OUT',
          quantity: damaged,
          unit: lot.unit,
          beforeQty: lot.availableQuantity,
          delta: damaged.negated(),
          afterQty: after,
        },
      });
      return {
        shipmentStatus: shipmentState,
        lotState,
        availableQuantity: after.toNumber(),
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
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', lotId);
      const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
      await assertQuantityReconciled(tx, lot);
      if (!lot.availableQuantity.greaterThan(0))
        throw new ConflictException('Lô không còn lượng khả dụng');
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
    assertBusinessActor(
      actor,
      party === 'transporter' ? TRANSPORT_WRITE_ROLES : RETAIL_WRITE_ROLES,
    );
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment)
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    const expected =
      party === 'transporter'
        ? shipment.transporterOrgId
        : shipment.retailerOrgId;
    if (actor.organizationId !== expected)
      throw new ForbiddenException(
        'Tổ chức hiện tại không có quyền quản lý chuyến hàng',
      );
    return shipment;
  }
  private async getAndAssertCurrentCustodian(
    id: string,
    actor: Actor,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    assertBusinessActor(actor, CUSTODY_WRITE_ROLES);
    const shipment = await db.shipment.findUnique({ where: { id } });
    if (!shipment)
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    if (!['IN_TRANSIT', 'ARRIVED'].includes(shipment.status))
      throw new ConflictException(
        'Không thể ghi nhận hư hỏng ở trạng thái hiện tại',
      );
    assertBusinessActor(
      actor,
      shipment.status === 'IN_TRANSIT'
        ? TRANSPORT_WRITE_ROLES
        : RETAIL_WRITE_ROLES,
    );
    const expected =
      shipment.status === 'IN_TRANSIT'
        ? shipment.transporterOrgId
        : shipment.retailerOrgId;
    if (actor.organizationId !== expected)
      throw new ForbiddenException(
        'Tổ chức hiện tại không đang quản lý lô hàng',
      );
    return shipment;
  }
  private time(input: ShipmentTransitionDto) {
    return input.occurredAt ? new Date(input.occurredAt) : new Date();
  }
}
