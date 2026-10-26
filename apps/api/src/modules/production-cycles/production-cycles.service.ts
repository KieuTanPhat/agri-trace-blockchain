import {
  assertBusinessActor,
  FARM_WRITE_ROLES,
} from '../auth/business-write.policy.js';
import { randomUUID } from 'node:crypto';
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
  effectiveCommandActor,
} from '../../common/idempotency/command-transaction.js';
import { quantity } from '../../common/quantity.js';
import { businessTimestamp } from '../../common/timestamp.js';
import { normalizeExpiryDate } from '../../common/expiry-date.js';
import { assertCultivatedArea } from '../../common/area.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { authorizeBusinessCommand } from '../supply-chains/business-policy.js';
import { activeChainBindingDigest } from '../ledger/ledger-permissions.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import {
  scopedCycleReadWhere,
  scopedLotReadWhere,
  scopedCycleRoleReadWhere,
} from '../supply-chains/business-read-scope.js';
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
  CreateProductionCycleDraftDto,
  LinkProductionCycleDraftDto,
  SetCycleStaffDto,
} from './dto.js';

/** A cycle's assignees: the responsible person first, then the other staff.
 * Defaults to the person creating it; every assignee is an active member of
 * the producing organization. */
async function cycleStaff(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: { responsibleUserId?: string; staffUserIds?: string[] },
) {
  const ids = [...new Set([input.responsibleUserId, ...(input.staffUserIds ?? [])].filter((id): id is string => !!id))];
  if (!ids.length) ids.push(actor.sub!);
  if (ids.length > 20) throw new UnprocessableEntityException('Tối đa 20 nhân viên cho một vụ');
  const active = await tx.user.count({ where: { id: { in: ids }, organizationId: actor.organizationId!, accountStatus: 'ACTIVE' } });
  if (active !== ids.length)
    throw new UnprocessableEntityException('Nhân viên phụ trách không thuộc doanh nghiệp hoặc chưa hoạt động');
  return ids;
}

/** Responsible person first, in assignment order. */
const staffIds = (responsible: string | null, staff: { userId: string }[]) =>
  [...new Set([...(responsible && staff.some((s) => s.userId === responsible) ? [responsible] : []), ...staff.map((s) => s.userId)])];

@Injectable()
export class ProductionCyclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly trace: TraceService,
  ) {}

  async list(actor: Actor) {
    const cycles = await this.prisma.productionCycle.findMany({
      where: this.visibleWhere(actor),
      include: {
        product: { select: { id: true, productName: true, defaultUnit: true } },
        farm: { select: { id: true, name: true } },
        plot: { select: { id: true, name: true } },
        staff: { select: { userId: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const reviewable = await this.prisma.productionCycle.findMany({
      where: {
        AND: [
          { id: { in: cycles.map((cycle) => cycle.id) } },
          scopedCycleRoleReadWhere(actor, 'COMPLIANCE_REVIEWER'),
        ],
      },
      select: { id: true },
    });
    const reviewIds = new Set(reviewable.map((cycle) => cycle.id));
    return Promise.all(
      cycles.map(async ({ staff, ...cycle }) => ({
        ...cycle,
        staffUserIds: staffIds(cycle.responsibleUserId, staff),
        canWriteProduction: await this.canWriteCycle(actor, cycle),
        canReviewCompliance: reviewIds.has(cycle.id),
      })),
    );
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
        certificates: true,
        staff: { select: { userId: true }, orderBy: { createdAt: 'asc' } },
        harvestEvents: {
          where: { lot: { is: scopedLotReadWhere(actor) } },
          include: { lot: { include: { shipment: true } }, sensorWindow: true },
          orderBy: { harvestTime: 'asc' },
        },
      },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy vụ sản xuất');
    const { staff, ...record } = cycle;
    return {
      ...record,
      staffUserIds: staffIds(cycle.responsibleUserId, staff),
      canWriteProduction: await this.canWriteCycle(actor, cycle),
      canReviewCompliance: Boolean(
        await this.prisma.productionCycle.findFirst({
          where: {
            AND: [
              { id: cycle.id },
              scopedCycleRoleReadWhere(actor, 'COMPLIANCE_REVIEWER'),
            ],
          },
          select: { id: true },
        }),
      ),
    };
  }

  private async canWriteCycle(
    actor: Actor,
    cycle: { id: string; chainId: string },
  ) {
    try {
      await authorizeBusinessCommand(this.prisma, actor, {
        chainId: cycle.chainId,
        role: 'FARM_STAFF',
        subject: { kind: 'cycle', id: cycle.id },
      });
      return true;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      )
        return false;
      throw error;
    }
  }

  private visibleWhere(actor: Actor): Prisma.ProductionCycleWhereInput {
    return scopedCycleReadWhere(actor);
  }

  async drafts(actor: Actor) {
    actor = effectiveCommandActor(actor);
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    const auth = await enterpriseAuthority(this.prisma, actor, 'production.read');
    return { items: await this.prisma.productionCycleDraft.findMany({
      where: {
        organizationId: actor.organizationId!,
        ...(auth.primary
          ? {}
          : { farmId: { in: [...new Set(auth.matching.flatMap((role) => role.siteIds))] } }),
        ...(actor.enterpriseScope?.cycleStaffOnly ? { staffUserIds: { has: actor.sub! } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    }) };
  }

  createDraft(input: CreateProductionCycleDraftDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    return commandTransaction(this.prisma, async (tx) => {
      await enterpriseAuthority(tx, actor, 'production.write', undefined, input.farmId, true);
      const [farm, plot, product, seed, responsible] = await Promise.all([
        tx.farm.findFirst({ where: { id: input.farmId, organizationId: actor.organizationId!, status: 'ACTIVE', evidenceComplete: true } }),
        tx.plot.findFirst({ where: { id: input.plotId, farmId: input.farmId, status: 'ACTIVE' } }),
        tx.product.findFirst({ where: { id: input.productId, status: 'ACTIVE', evidenceComplete: true, OR: [{ organizationId: actor.organizationId! }, { organizationId: null }] } }),
        input.seedMaterialId ? tx.productionMaterial.findFirst({ where: { id: input.seedMaterialId, organizationId: actor.organizationId!, kind: 'SEED', status: 'ACTIVE', evidenceComplete: true } }) : null,
        input.responsibleUserId ? tx.user.findFirst({ where: { id: input.responsibleUserId, organizationId: actor.organizationId!, accountStatus: 'ACTIVE' } }) : null,
      ]);
      if (!farm || !plot || !product) throw new UnprocessableEntityException('Vùng, thửa đất hoặc sản phẩm không hợp lệ');
      if (input.seedMaterialId && !seed) throw new UnprocessableEntityException('Giống không thuộc doanh nghiệp hoặc chưa hoạt động');
      if (input.responsibleUserId && !responsible) throw new UnprocessableEntityException('Người phụ trách không thuộc doanh nghiệp hoặc chưa hoạt động');
      const startDate = normalizeExpiryDate(input.startDate);
      const plannedHarvest = normalizeExpiryDate(input.plannedHarvest);
      if (plannedHarvest < startDate) throw new UnprocessableEntityException('Ngày dự kiến thu hoạch phải sau ngày bắt đầu');
      assertCultivatedArea(input.cultivatedArea, plot, farm);
      const staff = await cycleStaff(tx, actor, input);
      const cycleCode = input.cycleCode?.trim() || `VU-${randomUUID().slice(0, 12).toUpperCase()}`;
      if (await tx.productionCycle.findFirst({ where: { farmId: farm.id, cycleCode } })) throw new ConflictException('Mã vụ đã được sử dụng');
      return { record: await tx.productionCycleDraft.create({ data: {
        organizationId: actor.organizationId!, farmId: farm.id, plotId: plot.id, productId: product.id,
        name: input.name.trim(), cycleCode, startDate, plannedHarvest,
        seedMaterialId: seed?.id, responsibleUserId: staff[0], staffUserIds: staff,
        cultivationMethod: input.cultivationMethod?.trim(),
        cultivatedArea: input.cultivatedArea,
        maxHarvestQuantity: input.maxHarvestQuantity === undefined ? undefined : quantity(input.maxHarvestQuantity),
        harvestUnit: input.harvestUnit.trim(), note: input.note?.trim(),
      } }) };
    });
  }

  async linkDraft(id: string, input: LinkProductionCycleDraftDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    const draft = await this.prisma.productionCycleDraft.findFirst({ where: { id, organizationId: actor.organizationId! } });
    if (!draft) throw new NotFoundException('Không tìm thấy vụ nháp');
    if (draft.version !== input.version) throw new ConflictException('Vụ nháp đã thay đổi');
    return this.create({
      chainId: input.chainId, farmId: draft.farmId, plotId: draft.plotId, productId: draft.productId,
      cycleCode: draft.cycleCode, name: draft.name, cultivatedArea: Number(draft.cultivatedArea),
      startDate: draft.startDate.toISOString().slice(0, 10),
      plannedHarvest: draft.plannedHarvest.toISOString().slice(0, 10),
      maxHarvestQuantity: draft.maxHarvestQuantity === null ? undefined : Number(draft.maxHarvestQuantity),
      harvestUnit: draft.harvestUnit, note: draft.note ?? undefined,
      seedMaterialId: draft.seedMaterialId ?? undefined,
      responsibleUserId: draft.responsibleUserId ?? undefined,
      staffUserIds: draft.staffUserIds.length ? draft.staffUserIds : undefined,
      cultivationMethod: draft.cultivationMethod ?? undefined,
    }, actor, { id, version: input.version });
  }

  async create(input: CreateProductionCycleDto, actor: Actor, fromDraft?: { id: string; version: number }) {
    actor = effectiveCommandActor(actor);
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    const farm = await this.access.assertFarmAccess(actor, input.farmId);
    const [product, plot] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: input.productId } }),
      input.plotId
        ? this.prisma.plot.findUnique({ where: { id: input.plotId } })
        : null,
    ]);
    if (!product || product.status !== 'ACTIVE' || !product.evidenceComplete)
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
      await authorizeBusinessCommand(tx, actor, { chainId: input.chainId, role: 'FARM_STAFF' }, true);
      await enterpriseAuthority(tx, actor, 'production.write', input.chainId, input.farmId, true);
      if (input.seedMaterialId && !(await tx.productionMaterial.findFirst({ where: { id: input.seedMaterialId, organizationId: actor.organizationId!, kind: 'SEED', status: 'ACTIVE', evidenceComplete: true } })))
        throw new UnprocessableEntityException('Giống không thuộc doanh nghiệp hoặc chưa hoạt động');
      if (input.responsibleUserId && !(await tx.user.findFirst({ where: { id: input.responsibleUserId, organizationId: actor.organizationId!, accountStatus: 'ACTIVE' } })))
        throw new UnprocessableEntityException('Người phụ trách không thuộc doanh nghiệp hoặc chưa hoạt động');
      if (fromDraft) {
        const consumed = await tx.productionCycleDraft.deleteMany({ where: {
          id: fromDraft.id, organizationId: actor.organizationId!, version: fromDraft.version,
          farmId: input.farmId, plotId: input.plotId, productId: input.productId, cycleCode: input.cycleCode,
        } });
        if (consumed.count !== 1) throw new ConflictException('Vụ nháp đã thay đổi hoặc được liên kết');
      }
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
        !activeFarm.evidenceComplete ||
        activeFarm.organization.status !== 'ACTIVE' ||
        activeFarm.organizationId !== actor.organizationId ||
        !activeProduct ||
        activeProduct.status !== 'ACTIVE' ||
        !activeProduct.evidenceComplete ||
        (activeProduct.organizationId !== null &&
          activeProduct.organizationId !== actor.organizationId) ||
        (input.plotId &&
          (!activePlot ||
            activePlot.status !== 'ACTIVE' ||
            activePlot.farmId !== farm.id))
      )
        throw new UnprocessableEntityException(
          'Dữ liệu nông trại/sản phẩm/thửa đất không còn hợp lệ',
        );
      assertCultivatedArea(input.cultivatedArea, activePlot, activeFarm);
      const staff = await cycleStaff(tx, actor, input);
      // A stream keeps its birth binding for life: reject an unbound stream
      // before any domain or trace/outbox write.
      await tx.$queryRaw`SELECT chain_id FROM chain_ledger_profile WHERE chain_id = ${input.chainId}::uuid FOR SHARE`;
      const bindingDigest = await activeChainBindingDigest(tx, input.chainId);
      if (!bindingDigest)
        throw new ConflictException(
          'Chuỗi cần binding Fabric hoạt động trước khi tạo vụ sản xuất',
        );
      const states = await tx.$queryRaw<
        Array<{ status: string }>
      >`SELECT status::text AS status FROM fabric_binding_state WHERE binding_digest = ${bindingDigest} FOR SHARE`;
      if (states[0]?.status !== 'ACTIVE')
        throw new ConflictException('Binding Fabric chưa hoạt động');
      const cycle = await tx.productionCycle.create({
        data: {
          ...(fromDraft ? { id: fromDraft.id } : {}),
          name: input.name?.trim(),
          cultivatedArea: input.cultivatedArea,
          seedMaterialId: input.seedMaterialId,
          responsibleUserId: staff[0],
          cultivationMethod: input.cultivationMethod?.trim(),
          cycleCode: input.cycleCode?.trim() || `VU-${randomUUID().slice(0, 12).toUpperCase()}`,
          farmId: farm.id,
          farmOrgId: farm.organizationId,
          chainId: input.chainId,
          plotId: input.plotId,
          productId: input.productId,
          startDate: input.startDate
            ? normalizeExpiryDate(input.startDate)
            : undefined,
          plannedHarvest: input.plannedHarvest
            ? normalizeExpiryDate(input.plannedHarvest)
            : undefined,
          maxHarvestQuantity:
            input.maxHarvestQuantity === undefined
              ? undefined
              : quantity(input.maxHarvestQuantity),
          harvestUnit: input.harvestUnit,
          note: input.note,
        },
      });
      // The cycle stays on this binding for life (route, commitment and
      // permissions follow the binding).
      await tx.cycleLedgerContext.create({
        data: { cycleId: cycle.id, chainId: input.chainId, bindingDigest },
      });
      await tx.stageAssignment.create({
        data: {
          chainId: input.chainId,
          organizationId: farm.organizationId,
          stage: 'PRODUCTION',
          cycleId: cycle.id,
          status: 'ACCEPTED',
        },
      });
      await tx.productionCycleStaff.createMany({
        data: staff.map((userId) => ({ cycleId: cycle.id, userId, organizationId: farm.organizationId, assignedBy: actor.sub! })),
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
          seedMaterialId: cycle.seedMaterialId,
          responsibleUserId: cycle.responsibleUserId,
          cultivationMethod: cycle.cultivationMethod,
          maxHarvestQuantity: cycle.maxHarvestQuantity?.toString() ?? null,
          harvestUnit: cycle.harvestUnit,
        },
      });
      if (fromDraft) {
        // The cycle keeps the draft id, so draft photos already name it. Evidence
        // rows are immutable; record each one on the ledger now that the cycle
        // exists, in upload order and with the same payload as a cycle upload.
        // Runs after the draft delete: uploads holding the draft lock are visible.
        const draftEvidence = await tx.traceEvidence.findMany({
          where: { organizationId: actor.organizationId!, entityType: 'CYCLE_DRAFT', entityId: cycle.id },
          orderBy: { createdAt: 'asc' },
        });
        for (const row of draftEvidence)
          await this.trace.createInTransaction(tx, {
            entityType: 'PRODUCTION_CYCLE',
            entityId: cycle.id,
            cycleId: cycle.id,
            eventType: 'EVIDENCE_ATTACHED',
            actor,
            businessData: { evidenceId: row.id, sha256: row.sha256, supersedesId: row.supersedesId, kind: row.kind, public: row.public },
          });
      }
      return cycle;
    });
  }

  async plant(id: string, input: PlantCycleDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    await this.access.assertProductionCycleAccess(actor, id);
    const plantedAt = businessTimestamp(input.plantedAt, 'Thời điểm trồng');
    return this.transition(
      id,
      input.version,
      ['CREATED'],
      'PLANTED',
      actor,
      'CYCLE_PLANTED',
      { plantedAt: plantedAt.toISOString() },
      { startDate: normalizeExpiryDate(plantedAt.toISOString()) },
      plantedAt,
    );
  }

  async addCare(id: string, input: CareRecordDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    await this.access.assertProductionCycleAccess(actor, id);
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'cycle', id);
      const plantedAt = await plantedTime(tx, id);
      if (!plantedAt)
        throw new ConflictException(
          'Chu kỳ cần mốc trồng trước khi ghi chăm sóc',
        );
      const eventTime = businessTimestamp(
        input.eventTime,
        'Thời điểm chăm sóc',
        { notBefore: plantedAt },
      );
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
        const material=input.materialId?await tx.productionMaterial.findFirst({where:{id:input.materialId,organizationId:actor.organizationId!,status:'ACTIVE'}}):null;
        if(input.materialId) {
          await enterpriseAuthority(tx,actor,'materials.read');
          if(!material || (material.expiryDate && material.expiryDate.toISOString().slice(0,10)<eventTime.toISOString().slice(0,10)))throw new ConflictException('Đầu vào không thuộc tổ chức, đã ngừng dùng hoặc hết hạn tại ngày sử dụng');
          if(input.unit && input.unit!==material.unit)throw new ConflictException('Đơn vị nhật ký khác danh mục vật tư');
        }
        const careEvidenceIds = [input.evidenceRef, ...(input.additionalEvidenceRefs ?? [])];
        if (new Set(careEvidenceIds).size !== careEvidenceIds.length)
          throw new UnprocessableEntityException('Ảnh nhật ký bị chọn trùng');
        const careEvidence = await tx.traceEvidence.findMany({ where: {
          id: { in: careEvidenceIds }, organizationId: actor.organizationId!,
          entityType: 'CYCLE', entityId: id, kind: 'CARE_IMAGE',
          mediaType: { in: ['image/png', 'image/jpeg'] },
        } });
        const superseded = await tx.traceEvidence.count({ where: { supersedesId: { in: careEvidenceIds } } });
        if (careEvidence.length !== careEvidenceIds.length || superseded)
          throw new ForbiddenException('Cần 1–5 ảnh nhật ký hiện hành thuộc vụ này');
      const performerUserId = input.performerUserId ?? actor.sub!;
      const assigned = await tx.productionCycleStaff.findFirst({ where: { cycleId: id, userId: performerUserId }, select: { userId: true } });
      if (performerUserId !== actor.sub && !assigned)
        throw new UnprocessableEntityException('Người thực hiện phải là tài khoản đang ghi hoặc thành viên được phân công cho vụ');
      if (!await tx.user.findFirst({ where: { id: performerUserId, organizationId: actor.organizationId!, accountStatus: 'ACTIVE' } }))
        throw new UnprocessableEntityException('Người thực hiện không còn hoạt động trong doanh nghiệp');
      const care = await tx.careRecord.create({
        data: {
          cycleId: id,
          performerUserId,
          cropCondition: input.cropCondition?.trim() || undefined,
          name: input.name.trim(),
          journalCode: `NK-${randomUUID().slice(0, 12).toUpperCase()}`,
          careType: input.careType,
          eventTime,
            materialId:material?.id,
            materialVersion:material?.version,
            materialName: material?.name ?? input.materialName,
            activeIngredient:material?.activeIngredient ?? input.activeIngredient,
            applicationArea:input.applicationArea,
            withdrawalPeriod:material?.withdrawalDays ?? input.withdrawalPeriod,
            evidenceRef:input.evidenceRef,
            evidenceIds: careEvidenceIds,
          quantity:
            input.quantity === undefined ? undefined : quantity(input.quantity),
            unit: material?.unit ?? input.unit,
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
          journalCode: care.journalCode,
          name: care.name,
          careType: care.careType,
          materialName: care.materialName,
            materialId:care.materialId,
            materialVersion:care.materialVersion,
            supplier:material?.supplier ?? null,
            batchCode:material?.batchCode ?? null,
            activeIngredient:care.activeIngredient,
            applicationArea:care.applicationArea,
            withdrawalPeriod:care.withdrawalPeriod,
            evidenceRef:care.evidenceRef,
            evidenceIds: careEvidenceIds.map((evidenceId) => ({
              evidenceId,
              sha256: careEvidence.find((row) => row.id === evidenceId)!.sha256,
            })),
          quantity: care.quantity?.toString() ?? null,
          unit: care.unit,
          method: care.method,
          note: care.note,
        },
      });
      return { care, version: input.version + 1 };
    });
  }

  async addSensorReading(id: string, input: SensorReadingDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
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
      const recordedAt = businessTimestamp(
        input.recordedAt,
        'Thời gian cảm biến',
      );
      await validateSensorTime(tx, id, recordedAt);
      const reading = await tx.sensorReading.create({
        data: {
          cycleId: id,
          deviceId: input.deviceId,
          sensorType: input.sensorType,
          value: input.value,
          unit: input.unit,
          recordedAt,
        },
      });
      const late = await markLateReading(tx, reading);
      return { ...reading, late };
    });
  }

  async close(id: string, input: VersionedCommandDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
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

  /** Replaces a cycle's assignees. Owners and managers only: a tier-3
   * employee cannot widen or hand over its own assignment. Not ledger content,
   * so the cycle version and its events are unchanged. */
  async setStaff(id: string, input: SetCycleStaffDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    if (actor.enterpriseScope?.cycleStaffOnly)
      throw new ForbiddenException('Nhân viên không được đổi người được giao vụ');
    const cycle = await this.access.assertProductionCycleAccess(actor, id);
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'cycle', id);
      if (cycle.farmOrgId !== actor.organizationId)
        throw new ForbiddenException('Vụ nằm ngoài doanh nghiệp');
      const staff = await cycleStaff(tx, actor, { staffUserIds: input.staffUserIds });
      const current = await tx.productionCycleStaff.findMany({ where: { cycleId: id }, select: { userId: true } });
      const removed = current.map((c) => c.userId).filter((u) => !staff.includes(u));
      await tx.productionCycleStaff.deleteMany({ where: { cycleId: id, userId: { in: removed } } });
      await tx.productionCycleStaff.createMany({
        data: staff.filter((u) => !current.some((c) => c.userId === u)).map((userId) => ({ cycleId: id, userId, organizationId: cycle.farmOrgId, assignedBy: actor.sub! })),
      });
      await tx.chainAudit.create({ data: { actorUserId: actor.sub!, operation: 'SET_CYCLE_STAFF', subjectId: id, revision: staff.length, chainId: cycle.chainId } });
      return { cycleId: id, staffUserIds: staff };
    });
  }

  async cancel(id: string, input: CancelCycleDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
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
    eventTime?: Date,
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
        eventTime,
        businessData: businessData,
      });
      return cycle;
    });
  }
}
