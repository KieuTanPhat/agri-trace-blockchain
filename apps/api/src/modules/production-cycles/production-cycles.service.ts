import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import type {
  CancelCycleDto,
  CareRecordDto,
  CreateProductionCycleDto,
  PlantCycleDto,
  SensorReadingDto,
  VersionedCommandDto,
} from './dto.js';

@Injectable()
export class ProductionCyclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly trace: TraceService,
  ) {}

  list(actor: Actor) {
    return this.prisma.productionCycle.findMany({
      where: this.visibleWhere(actor),
      include: {
        product: { select: { id: true, productName: true, defaultUnit: true } },
        farm: { select: { id: true, name: true } },
        plot: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, actor: Actor) {
    const cycle = await this.prisma.productionCycle.findFirst({
      where: { id, ...this.visibleWhere(actor) },
      include: {
        product: true,
        farm: true,
        plot: true,
        careRecords: { orderBy: { eventTime: 'asc' } },
        sensorReadings: { orderBy: { recordedAt: 'desc' }, take: 100 },
        sensorDigests: { orderBy: { periodEnd: 'desc' } },
        certificates: true,
        harvestEvents: {
          include: { lot: { include: { shipment: true } } },
          orderBy: { harvestTime: 'asc' },
        },
      },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy vụ sản xuất');
    return cycle;
  }

  private visibleWhere(actor: Actor): Prisma.ProductionCycleWhereInput {
    if (['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)) return {};
    if (actor.role === 'FARM_STAFF')
      return { farmOrgId: actor.organizationId ?? undefined };
    if (actor.role === 'TRANSPORTER')
      return {
        harvestEvents: {
          some: {
            lot: {
              shipment: {
                transporterOrgId: actor.organizationId ?? undefined,
              },
            },
          },
        },
      };
    if (actor.role === 'RETAILER')
      return {
        harvestEvents: {
          some: {
            lot: {
              shipment: { retailerOrgId: actor.organizationId ?? undefined },
            },
          },
        },
      };
    return { id: '__not_authorized__' };
  }

  async create(input: CreateProductionCycleDto, actor: Actor) {
    const farm = await this.access.assertFarmAccess(actor, input.farmId);

    const [product, plot] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: input.productId },
      }),
      input.plotId
        ? this.prisma.plot.findUnique({
            where: { id: input.plotId },
          })
        : null,
    ]);

    if (!product || product.status !== 'ACTIVE') {
      throw new NotFoundException(
        'Sản phẩm không tồn tại hoặc không hoạt động',
      );
    }

    if (plot && (plot.farmId !== farm.id || plot.status !== 'ACTIVE')) {
      throw new UnprocessableEntityException(
        'Thửa đất không thuộc nông trại hoặc không hoạt động',
      );
    }

    const startDate = input.startDate ? new Date(input.startDate) : null;
    const plannedHarvest = input.plannedHarvest
      ? new Date(input.plannedHarvest)
      : null;

    if (startDate && plannedHarvest && plannedHarvest < startDate) {
      throw new UnprocessableEntityException(
        'Ngày thu hoạch dự kiến không được trước ngày bắt đầu vụ',
      );
    }

    if (
      product.defaultUnit &&
      !this.sameUnit(product.defaultUnit, input.harvestUnit)
    ) {
      throw new UnprocessableEntityException(
        `Đơn vị thu hoạch phải là ${product.defaultUnit}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.productionCycle.create({
        data: {
          cycleCode: input.cycleCode.trim(),
          farmId: farm.id,
          farmOrgId: farm.organizationId,
          plotId: input.plotId,
          productId: input.productId,
          startDate: startDate ?? undefined,
          plannedHarvest: plannedHarvest ?? undefined,
          maxHarvestQuantity: input.maxHarvestQuantity,
          harvestUnit: input.harvestUnit.trim(),
          note: input.note,
        },
      });

      await this.trace.createInTransaction(tx, {
        entityType: 'PRODUCTION_CYCLE',
        entityId: cycle.id,
        cycleId: cycle.id,
        eventType: 'PRODUCTION_CYCLE_CREATED',
        actor,
        businessData: {
          cycleCode: cycle.cycleCode,
          farmId: cycle.farmId,
          plotId: cycle.plotId,
          productId: cycle.productId,
          maxHarvestQuantity:
            cycle.maxHarvestQuantity?.toString() ?? null,
          harvestUnit: cycle.harvestUnit,
        },
      });

      return cycle;
    });
  }

  async plant(id: string, input: PlantCycleDto, actor: Actor) {
    await this.access.assertProductionCycleAccess(actor, id);

    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id },
    });

    if (!cycle) {
      throw new NotFoundException('Không tìm thấy vụ sản xuất');
    }

    const plantedAt = new Date(input.plantedAt);

    if (
      cycle.plannedHarvest &&
      this.datePart(plantedAt) > this.datePart(cycle.plannedHarvest)
    ) {
      throw new UnprocessableEntityException(
        'Ngày gieo trồng không được sau ngày thu hoạch dự kiến',
      );
    }

    return this.transition(
      id,
      input.version,
      ['CREATED'],
      'PLANTED',
      actor,
      'CYCLE_PLANTED',
      {
        plantedAt: input.plantedAt,
      },
      {
        startDate: plantedAt,
      },
    );
  }

  async addCare(id: string, input: CareRecordDto, actor: Actor) {
    await this.access.assertProductionCycleAccess(actor, id);

    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id },
    });

    if (!cycle) {
      throw new NotFoundException('Không tìm thấy vụ sản xuất');
    }

    const eventTime = new Date(input.eventTime);

    this.assertEventTimeInCycle(
      eventTime,
      cycle.startDate,
      cycle.plannedHarvest,
      'Thời gian chăm sóc',
    );

    if ((input.quantity == null) !== (input.unit == null)) {
      throw new UnprocessableEntityException(
        'Số lượng và đơn vị chăm sóc phải được nhập cùng nhau',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.productionCycle.updateMany({
        where: {
          id,
          version: input.version,
          currentState: {
            in: ['PLANTED', 'GROWING'],
          },
        },
        data: {
          currentState: 'GROWING',
          version: {
            increment: 1,
          },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException(
          'Version hoặc trạng thái chu kỳ không hợp lệ',
        );
      }

      const care = await tx.careRecord.create({
        data: {
          cycleId: id,
          careType: input.careType,
          eventTime,
          materialName: input.materialName,
          quantity: input.quantity,
          unit: input.unit,
          method: input.method,
          note: input.note,
        },
      });

      await this.trace.createInTransaction(tx, {
        entityType: 'CARE',
        entityId: care.id,
        cycleId: id,
        eventType: 'CARE_RECORDED',
        actor,
        eventTime: care.eventTime,
        businessData: {
          careType: care.careType,
          materialName: care.materialName,
          quantity: care.quantity?.toString() ?? null,
          unit: care.unit,
        },
      });

      return {
        care,
        version: input.version + 1,
      };
    });
  }

  async addSensorReading(
    id: string,
    input: SensorReadingDto,
    actor: Actor,
  ) {
    await this.access.assertProductionCycleAccess(actor, id);

    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id },
      include: {
        farm: {
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!cycle) {
      throw new NotFoundException('Không tìm thấy vụ sản xuất');
    }

    const recordedAt = new Date(input.recordedAt);

    this.assertEventTimeInCycle(
      recordedAt,
      cycle.startDate,
      cycle.plannedHarvest,
      'Thời gian cảm biến',
    );

    const device = await this.prisma.iotDevice.findUnique({
      where: {
        id: input.deviceId,
      },
    });

    if (
      !device ||
      device.cycleId !== id ||
      device.organizationId !== cycle.farm.organizationId ||
      device.status !== 'ACTIVE'
    ) {
      throw new UnprocessableEntityException(
        'Thiết bị không thuộc chu kỳ hoặc không hoạt động',
      );
    }

    return this.prisma.sensorReading.create({
      data: {
        cycleId: id,
        deviceId: input.deviceId,
        sensorType: input.sensorType,
        value: input.value,
        unit: input.unit,
        recordedAt,
      },
    });
  }

  async close(id: string, input: VersionedCommandDto, actor: Actor) {
    await this.access.assertProductionCycleAccess(actor, id);
    return this.transition(
      id,
      input.version,
      ['PLANTED', 'GROWING'],
      'COMPLETED',
      actor,
      'CYCLE_COMPLETED',
      {},
    );
  }

  async cancel(id: string, input: CancelCycleDto, actor: Actor) {
    await this.access.assertProductionCycleAccess(actor, id);
    return this.transition(
      id,
      input.version,
      ['CREATED', 'PLANTED', 'GROWING'],
      'CANCELLED',
      actor,
      'CYCLE_CANCELLED',
      { reason: input.reason },
    );
  }

  private async transition(
    id: string,
    version: number,
    from: Array<'CREATED' | 'PLANTED' | 'GROWING'>,
    to: 'PLANTED' | 'COMPLETED' | 'CANCELLED',
    actor: Actor,
    eventType: string,
    businessData: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.productionCycle.updateMany({
        where: { id, version, currentState: { in: from } },
        data: { ...extra, currentState: to, version: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new ConflictException(
          'Version hoặc trạng thái chu kỳ không hợp lệ',
        );
      const cycle = await tx.productionCycle.findUniqueOrThrow({
        where: { id },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'PRODUCTION_CYCLE',
        entityId: id,
        cycleId: id,
        eventType,
        actor,
        businessData: businessData as never,
      });
      return cycle;
    });
  }

  private assertEventTimeInCycle(
    eventTime: Date,
    startDate: Date | null,
    plannedHarvest: Date | null,
    fieldName: string,
  ): void {
    const eventDate = this.datePart(eventTime);

    if (startDate && eventDate < this.datePart(startDate)) {
      throw new UnprocessableEntityException(
        `${fieldName} không được trước ngày bắt đầu vụ`,
      );
    }

    if (
      plannedHarvest &&
      eventDate > this.datePart(plannedHarvest)
    ) {
      throw new UnprocessableEntityException(
        `${fieldName} không được sau ngày thu hoạch dự kiến`,
      );
    }
  }

  private sameUnit(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  private datePart(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
