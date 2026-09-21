import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
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

  async create(input: CreateProductionCycleDto, actor: Actor) {
    const farm = await this.access.assertFarmAccess(actor, input.farmId);
    const [product, plot] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: input.productId } }),
      input.plotId
        ? this.prisma.plot.findUnique({ where: { id: input.plotId } })
        : null,
    ]);
    if (!product || product.status !== 'ACTIVE')
      throw new NotFoundException(
        'Sản phẩm không tồn tại hoặc không hoạt động',
      );
    if (plot && (plot.farmId !== farm.id || plot.status !== 'ACTIVE'))
      throw new UnprocessableEntityException(
        'Thửa đất không thuộc nông trại hoặc không hoạt động',
      );

    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.productionCycle.create({
        data: {
          cycleCode: input.cycleCode.trim(),
          farmId: farm.id,
          farmOrgId: farm.organizationId,
          plotId: input.plotId,
          productId: input.productId,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          plannedHarvest: input.plannedHarvest
            ? new Date(input.plannedHarvest)
            : undefined,
          maxHarvestQuantity: input.maxHarvestQuantity,
          harvestUnit: input.harvestUnit,
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
          maxHarvestQuantity: String(cycle.maxHarvestQuantity),
          harvestUnit: cycle.harvestUnit,
        },
      });
      return cycle;
    });
  }

  async plant(id: string, input: PlantCycleDto, actor: Actor) {
    await this.access.assertProductionCycleAccess(actor, id);
    return this.transition(
      id,
      input.version,
      ['CREATED'],
      'PLANTED',
      actor,
      'CYCLE_PLANTED',
      { plantedAt: input.plantedAt },
      { startDate: new Date(input.plantedAt) },
    );
  }

  async addCare(id: string, input: CareRecordDto, actor: Actor) {
    await this.access.assertProductionCycleAccess(actor, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.productionCycle.updateMany({
        where: {
          id,
          version: input.version,
          currentState: { in: ['PLANTED', 'GROWING'] },
        },
        data: { currentState: 'GROWING', version: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          'Version hoặc trạng thái chu kỳ không hợp lệ',
        );
      const care = await tx.careRecord.create({
        data: {
          cycleId: id,
          careType: input.careType,
          eventTime: new Date(input.eventTime),
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
      return { care, version: input.version + 1 };
    });
  }

  async addSensorReading(id: string, input: SensorReadingDto, actor: Actor) {
    const cycle = await this.access.assertProductionCycleAccess(actor, id);
    const device = await this.prisma.iotDevice.findUnique({
      where: { id: input.deviceId },
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
    return this.prisma.$transaction(async (tx) => {
      const reading = await tx.sensorReading.create({
        data: {
          cycleId: id,
          deviceId: input.deviceId,
          sensorType: input.sensorType,
          value: input.value,
          unit: input.unit,
          recordedAt: new Date(input.recordedAt),
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'SENSOR',
        entityId: reading.id,
        cycleId: id,
        eventType: 'SENSOR_READING_RECORDED',
        actor,
        eventTime: reading.recordedAt,
        businessData: {
          deviceId: reading.deviceId,
          sensorType: reading.sensorType,
          value: reading.value.toString(),
          unit: reading.unit,
        },
      });
      return reading;
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
}
