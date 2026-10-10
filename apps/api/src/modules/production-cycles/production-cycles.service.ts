import {
  assertBusinessActor,
  FARM_WRITE_ROLES,
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
import { quantity } from '../../common/quantity.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { assignedFarmWhere } from '../auth/compliance-scope.js';
import {
  validateSensorTime,
  markLateReading,
  plantedTime,
} from '../iot/harvest-sensor-window.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import type {
  CancelCycleDto,
  CareRecordDto,
  CreateProductionCycleDto,
  PlantCycleDto,
  SensorReadingDto,
  VersionedCommandDto,
  ReconcileCycleSensorDto,
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
    if (actor.role === 'COMPLIANCE_REVIEWER')
      return { farm: assignedFarmWhere(actor) };
    if (actor.role === 'FARM_STAFF')
      return {
        farmOrgId:
          actor.organizationId ?? '00000000-0000-0000-0000-000000000000',
      };
    if (actor.role === 'TRANSPORTER')
      return {
        harvestEvents: {
          some: {
            lot: {
              shipment: {
                transporterOrgId:
                  actor.organizationId ??
                  '00000000-0000-0000-0000-000000000000',
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
              shipment: {
                retailerOrgId:
                  actor.organizationId ??
                  '00000000-0000-0000-0000-000000000000',
              },
            },
          },
        },
      };
    return { id: '00000000-0000-0000-0000-000000000000' };
  }

  async create(input: CreateProductionCycleDto, actor: Actor) {
    assertBusinessActor(actor, FARM_WRITE_ROLES);
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
    if (
      (input.plotId && !plot) ||
      (plot && (plot.farmId !== farm.id || plot.status !== 'ACTIVE'))
    )
      throw new UnprocessableEntityException(
        'Thửa đất không thuộc nông trại hoặc không hoạt động',
      );

    return commandTransaction(this.prisma, async (tx) => {
      const activeFarm = await tx.farm.findUnique({
        where: { id: farm.id },
        include: { organization: true },
      });
      const activeProduct = await tx.product.findUnique({
        where: { id: input.productId },
      });
      const activePlot = input.plotId
        ? await tx.plot.findUnique({ where: { id: input.plotId } })
        : null;
      if (
        !activeFarm ||
        activeFarm.status !== 'ACTIVE' ||
        activeFarm.organization.status !== 'ACTIVE' ||
        activeFarm.organizationId !== actor.organizationId ||
        !activeProduct ||
        activeProduct.status !== 'ACTIVE' ||
        (input.plotId &&
          (!activePlot ||
            activePlot.status !== 'ACTIVE' ||
            activePlot.farmId !== farm.id))
      )
        throw new UnprocessableEntityException(
          'Dữ liệu nông trại/sản phẩm/thửa đất không còn hợp lệ',
        );
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
          maxHarvestQuantity:
            input.maxHarvestQuantity === undefined
              ? undefined
              : quantity(input.maxHarvestQuantity),
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
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    await this.access.assertProductionCycleAccess(actor, id);
    if (new Date(input.plantedAt).getTime() > Date.now())
      throw new UnprocessableEntityException(
        'Thời điểm trồng không được ở tương lai',
      );
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
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    await this.access.assertProductionCycleAccess(actor, id);
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'cycle', id);
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
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    const cycle = await this.access.assertProductionCycleAccess(actor, id);
    if (!['PLANTED', 'GROWING'].includes(cycle.currentState)) {
      throw new UnprocessableEntityException(
        'Cycle is not accepting sensor readings',
      );
    }
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
    // Raw sensor readings are deliberately kept off-chain. SensorDigest is the
    // auditable aggregate that produces TraceEvent/BlockchainProof records.
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'cycle', id);
      const currentCycle = await tx.productionCycle.findUniqueOrThrow({
        where: { id },
      });
      const currentDevice = await tx.iotDevice.findUniqueOrThrow({
        where: { id: input.deviceId },
      });
      if (
        !['PLANTED', 'GROWING'].includes(currentCycle.currentState) ||
        currentDevice.status !== 'ACTIVE' ||
        currentDevice.cycleId !== id ||
        currentDevice.organizationId !== currentCycle.farmOrgId
      )
        throw new ConflictException(
          'Chu kỳ hoặc thiết bị không còn nhận dữ liệu',
        );
      await validateSensorTime(tx, id, new Date(input.recordedAt));
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
      const late = await markLateReading(tx, reading);
      return { ...reading, late };
    });
  }

  async reconcileSensorHistory(
    id: string,
    input: ReconcileCycleSensorDto,
    actor: Actor,
  ) {
    if (actor.role !== 'SYSTEM_ADMIN' || !actor.sub)
      throw new ForbiddenException('Chỉ Admin được ghi đối soát legacy');
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'cycle', id);
      const cycle = await tx.productionCycle.findUnique({ where: { id } });
      if (!cycle) throw new NotFoundException('Không tìm thấy vụ sản xuất');
      if (
        cycle.version !== input.version ||
        !['PLANTED', 'GROWING'].includes(cycle.currentState)
      )
        throw new ConflictException('Version/trạng thái chu kỳ đã thay đổi');
      if (await tx.harvestSensorWindow.count({ where: { cycleId: id } }))
        throw new ConflictException(
          'Không thay đổi mốc legacy sau khi đã finalize window mới',
        );
      const legacy = await tx.harvestEvent.findMany({
        where: { cycleId: id },
        orderBy: [{ harvestTime: 'desc' }, { id: 'desc' }],
        include: { finalSensorDigest: true },
      });
      const last = legacy[0];
      if ((input.throughHarvestId ?? null) !== (last?.id ?? null))
        throw new ConflictException(
          'Cần đối soát đến đúng harvest legacy cuối cùng',
        );
      const start = new Date(input.plantedAt);
      const known = await plantedTime(tx, id);
      if (
        !Number.isFinite(start.getTime()) ||
        start.getTime() > Date.now() ||
        (last && start >= last.harvestTime) ||
        (known && start.getTime() !== known.getTime()) ||
        legacy.some(
          (harvest) =>
            harvest.harvestTime < start ||
            harvest.harvestTime.getTime() > Date.now(),
        ) ||
        !input.reason.trim()
      )
        throw new UnprocessableEntityException(
          'Mốc trồng/cutoff/lý do đối soát không hợp lệ',
        );
      const previous = await tx.cycleSensorReconciliation.aggregate({
        where: { cycleId: id },
        _max: { revision: true },
      });
      const record = await tx.cycleSensorReconciliation.create({
        data: {
          cycleId: id,
          revision: (previous._max.revision ?? 0) + 1,
          throughHarvestId: last?.id,
          plantedAt: start,
          cutoffEnd: last?.harvestTime,
          recordedById: actor.sub!,
          reason: input.reason.trim(),
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'PRODUCTION_CYCLE',
        entityId: id,
        cycleId: id,
        eventType: 'CORRECTION_RECORDED',
        actor,
        businessData: {
          reconciliationId: record.id,
          revision: record.revision,
          plantedAt: start.toISOString(),
          cutoffEnd: record.cutoffEnd?.toISOString() ?? null,
          throughHarvestId: record.throughHarvestId,
          reason: record.reason,
          legacySources: legacy.map((harvest) => ({
            harvestId: harvest.id,
            finalSensorDigestId: harvest.finalSensorDigestId,
            digestHash: harvest.finalSensorDigest?.digestHash ?? null,
          })),
        },
      });
      await tx.productionCycle.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      return { reconciliation: record, cycleVersion: cycle.version + 1 };
    });
  }

  async close(id: string, input: VersionedCommandDto, actor: Actor) {
    assertBusinessActor(actor, FARM_WRITE_ROLES);
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
    assertBusinessActor(actor, FARM_WRITE_ROLES);
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
    businessData: Prisma.InputJsonObject,
    extra: Record<string, unknown> = {},
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'cycle', id);
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
        businessData: businessData,
      });
      return cycle;
    });
  }
}
