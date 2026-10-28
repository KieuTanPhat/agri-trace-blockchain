import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  commandTransaction,
  effectiveCommandActor,
  lockAggregate,
} from '../../common/idempotency/command-transaction.js';
import { quantity } from '../../common/quantity.js';
import { normalizeExpiryDate } from '../../common/expiry-date.js';
import { businessTimestamp } from '../../common/timestamp.js';
import {
  prepareHarvestSensorWindow,
  finalizeHarvestSensorWindow,
} from '../iot/harvest-sensor-window.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import {
  assertBusinessActor,
  FARM_WRITE_ROLES,
} from '../auth/business-write.policy.js';
import { TraceService, type Actor } from '../trace/trace.service.js';
import type { RecordHarvestDto } from './dto.js';

@Injectable()
export class LotHarvestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly trace: TraceService,
  ) {}

  async recordHarvest(cycleId: string, input: RecordHarvestDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    await this.access.assertProductionCycleAccess(actor, cycleId);
    const harvestedQuantity = quantity(input.quantity);
    return commandTransaction(
      this.prisma,
      async (tx) => {
        await lockAggregate(tx, 'cycle', cycleId);
        const cycle = await tx.productionCycle.findUnique({
          where: { id: cycleId },
        });
        if (!cycle)
          throw new NotFoundException('Không tìm thấy chu kỳ sản xuất');
        if (cycle.version !== input.version)
          throw new ConflictException('Vụ đã thay đổi; tải lại trước khi thu hoạch');
        if (!['PLANTED', 'GROWING'].includes(cycle.currentState))
          throw new ConflictException(
            'Chu kỳ không ở trạng thái có thể thu hoạch',
          );
        const representative = await tx.user.findFirst({ where: {
          id: input.representativeUserId,
          organizationId: actor.organizationId!,
          accountStatus: 'ACTIVE',
        }, select: { id: true, fullName: true } });
        const assigned = await tx.productionCycleStaff.findMany({ where: { cycleId }, select: { userId: true } });
        if (!representative || !(assigned.length ? assigned.some((a) => a.userId === input.representativeUserId) : input.representativeUserId === actor.sub))
          throw new UnprocessableEntityException('Người đại diện phải là nhân viên được giao vụ, hoặc tài khoản đang ghi khi vụ chưa giao ai');
        const harvestEvidenceIds = [input.evidenceRef, ...(input.additionalEvidenceRefs ?? [])];
        if (new Set(harvestEvidenceIds).size !== harvestEvidenceIds.length)
          throw new UnprocessableEntityException('Ảnh thu hoạch bị chọn trùng');
        const harvestEvidence = await tx.traceEvidence.findMany({
          where: {
            id: { in: harvestEvidenceIds },
            organizationId: actor.organizationId!,
            entityType: 'CYCLE',
            entityId: cycleId,
            kind: 'HARVEST_IMAGE',
            mediaType: { in: ['image/png', 'image/jpeg'] },
          },
        });
        const supersededHarvestImages = await tx.traceEvidence.count({ where: { supersedesId: { in: harvestEvidenceIds } } });
        if (harvestEvidence.length !== harvestEvidenceIds.length || supersededHarvestImages)
          throw new UnprocessableEntityException('Cần 1–5 ảnh thu hoạch hiện hành thuộc vụ này');
        const primaryHarvestEvidence = harvestEvidence.find((row) => row.id === input.evidenceRef)!;
        const lotImage = await tx.traceEvidence.findFirst({
          where: {
            id: input.lotImageEvidenceRef,
            organizationId: actor.organizationId!,
            entityType: 'CYCLE',
            entityId: cycleId,
            kind: 'LOT_IMAGE',
            mediaType: { in: ['image/png', 'image/jpeg'] },
          },
        });
        if (!lotImage || await tx.traceEvidence.findFirst({ where: { supersedesId: lotImage.id } }))
          throw new UnprocessableEntityException('Cần ảnh lô hiện hành thuộc vụ này');
        const evidenceUsage = await tx.traceEvidence.aggregate({ where: { organizationId: actor.organizationId! }, _count: true, _sum: { size: true } });
        if (evidenceUsage._count >= 1000 || (evidenceUsage._sum.size ?? 0) + lotImage.size > 256 * 1024 * 1024)
          throw new ConflictException('Đã đạt giới hạn lưu chứng cứ của tổ chức');
        if (cycle.harvestUnit && cycle.harvestUnit !== input.unit)
          throw new UnprocessableEntityException(
            'Đơn vị thu hoạch không khớp kế hoạch',
          );
        if (
          await tx.harvestEvent.findFirst({
            where: { cycleId, unit: { not: input.unit } },
            select: { id: true },
          })
        )
          throw new ConflictException(
            'Lịch sử thu hoạch có đơn vị khác; cần đối soát trước khi ghi tiếp',
          );
        const harvestTime = businessTimestamp(
          input.harvestTime,
          'Thời điểm thu hoạch',
        );
        const expiryDate = input.expiryDate
          ? normalizeExpiryDate(input.expiryDate)
          : undefined;
        const packedAt = input.packedAt ? normalizeExpiryDate(input.packedAt) : undefined;
        if (packedAt && packedAt < normalizeExpiryDate(harvestTime.toISOString()))
          throw new UnprocessableEntityException('Ngày đóng gói không trước ngày thu hoạch');
        if (expiryDate && packedAt && expiryDate < packedAt)
          throw new UnprocessableEntityException('Ngày hết hạn không trước ngày đóng gói');
        if (input.initialStorageSiteId) {
          const site = await tx.enterpriseSite.findFirst({ where: { id: input.initialStorageSiteId, organizationId: actor.organizationId!, status: 'ACTIVE' } });
          if (!site) throw new UnprocessableEntityException('Cơ sở lưu giữ ban đầu không thuộc tổ chức hoặc chưa hoạt động');
        }
        if (
          expiryDate &&
          expiryDate < normalizeExpiryDate(harvestTime.toISOString())
        )
          throw new UnprocessableEntityException(
            'Ngày hết hạn phải từ ngày thu hoạch',
          );
        const sensorSnapshot = await prepareHarvestSensorWindow(
          tx,
          cycleId,
          harvestTime,
        );
        const aggregate = await tx.harvestEvent.aggregate({
          where: { cycleId },
          _sum: { quantity: true },
        });
        const harvested = aggregate._sum.quantity ?? new Prisma.Decimal(0);
        const total = harvested.add(harvestedQuantity);
        if (
          cycle.maxHarvestQuantity &&
          total.greaterThan(cycle.maxHarvestQuantity)
        ) {
          throw new UnprocessableEntityException(
            'Tổng sản lượng thu hoạch vượt giới hạn của chu kỳ',
          );
        }
        const harvest = await tx.harvestEvent.create({
          data: {
            cycleId,
            harvestCode: `TH-${randomUUID().slice(0, 12).toUpperCase()}`,
            harvestTime,
            quantity: harvestedQuantity,
            unit: input.unit,
            grade: input.grade,
            qualityNote: input.qualityNote,
            harvestArea: input.harvestArea,
            evidenceRef: primaryHarvestEvidence.id,
            evidenceIds: harvestEvidenceIds,
            representativeUserId: representative.id,
            representative: representative.fullName,
            harvestMethod: input.harvestMethod,
            note: input.note,
          },
        });
        const lotCode =
          input.lotCode?.trim() ||
          `LOT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${harvest.id.slice(0, 8).toUpperCase()}`;
        const lot = await tx.lot.create({
          data: {
            lotCode,
            lotName: input.lotName,
            harvestId: harvest.id,
            productId: cycle.productId,
            farmOrgId: cycle.farmOrgId,
            initialQuantity: harvestedQuantity,
            availableQuantity: harvestedQuantity,
            unit: input.unit,
            grade: input.grade,
            expiryDate,
            packageCount: input.packageCount,
            packaging: input.packaging,
            packedAt,
            initialStorageSiteId: input.initialStorageSiteId,
          },
        });
        const lotEvidence = await tx.traceEvidence.create({ data: {
          organizationId: actor.organizationId!, entityType: 'LOT', entityId: lot.id,
          chainId: cycle.chainId, fileName: lotImage.fileName, mediaType: lotImage.mediaType,
          size: lotImage.size, sha256: lotImage.sha256, content: lotImage.content,
          description: lotImage.description, kind: 'LOT_IMAGE', public: false, actorId: actor.sub!,
        } });
        const sensorWindow = await finalizeHarvestSensorWindow(
          tx,
          sensorSnapshot,
          harvest.id,
        );
        await this.trace.createInTransaction(tx, {
          entityType: 'SENSOR_DIGEST',
          entityId: sensorWindow.id,
          cycleId,
          lotId: lot.id,
          eventType: 'SENSOR_DIGEST_FINALIZED',
          actor,
          eventTime: harvest.harvestTime,
          businessData: {
            windowId: sensorWindow.id,
            harvestId: harvest.id,
            periodStart: sensorWindow.periodStart.toISOString(),
            periodEnd: sensorWindow.periodEnd.toISOString(),
            includeStart: sensorWindow.includeStart,
            status: sensorWindow.status,
            digestHash: sensorWindow.digestHash,
            readingCount: sensorWindow.readingCount,
            schemaVersion: sensorWindow.schemaVersion,
          },
        });
        const event = await this.trace.createInTransaction(tx, {
          entityType: 'HARVEST',
          entityId: harvest.id,
          cycleId,
          lotId: lot.id,
          eventType: 'HARVEST_RECORDED',
          actor,
          eventTime: harvest.harvestTime,
          businessData: {
            harvestCode: harvest.harvestCode,
            lotCode,
            lotName: input.lotName,
            quantity: harvestedQuantity.toString(),
            unit: input.unit,
            grade: input.grade ?? null,
            expiryDate: lot.expiryDate?.toISOString().slice(0, 10) ?? null,
            qualityNote: input.qualityNote ?? null,
            harvestArea: input.harvestArea ?? null,
            representative: representative.fullName,
            representativeUserId: representative.id,
            harvestMethod: input.harvestMethod ?? null,
            packageCount: input.packageCount ?? null,
            packaging: input.packaging ?? null,
            packedAt: packedAt?.toISOString().slice(0, 10) ?? null,
            initialStorageSiteId: input.initialStorageSiteId ?? null,
            note: input.note ?? null,
            evidenceRef: primaryHarvestEvidence.id,
            evidenceSha256: primaryHarvestEvidence.sha256,
            evidenceIds: harvestEvidenceIds.map((evidenceId) => ({
              evidenceId,
              sha256: harvestEvidence.find((row) => row.id === evidenceId)!.sha256,
            })),
            lotImageEvidenceId: lotEvidence.id,
            lotImageSha256: lotEvidence.sha256,
            sensorWindowId: sensorWindow.id,
            sensorEvidenceStatus: sensorWindow.status,
          },
        });
        await this.trace.createInTransaction(tx, {
          entityType: 'LOT', entityId: lot.id, cycleId, lotId: lot.id,
          eventType: 'EVIDENCE_ATTACHED', actor,
          businessData: { evidenceId: lotEvidence.id, sha256: lotEvidence.sha256, sourceEvidenceId: lotImage.id, kind: 'LOT_IMAGE', public: false },
        });
        await tx.quantityMovement.create({
          data: {
            lotId: lot.id,
            eventId: event.id,
            type: 'HARVEST_IN',
            quantity: harvestedQuantity,
            unit: input.unit,
            beforeQty: 0,
            delta: harvestedQuantity,
            afterQty: harvestedQuantity,
          },
        });
        if (input.initialStorageSiteId) {
          await tx.lotHolding.create({ data: {
            lotId: lot.id, organizationId: actor.organizationId!, quantity: harvestedQuantity,
          } });
          await tx.lotSiteHolding.create({ data: {
            lotId: lot.id, organizationId: actor.organizationId!,
            siteId: input.initialStorageSiteId, quantity: harvestedQuantity,
          } });
          await this.trace.createInTransaction(tx, {
            entityType: 'LOT', entityId: lot.id, cycleId, lotId: lot.id,
            eventType: 'DISTRIBUTION_SITE_ALLOCATED', actor,
            businessData: {
              siteId: input.initialStorageSiteId, fromSiteId: null,
              quantity: harvestedQuantity.toFixed(3), unit: input.unit,
              reason: 'Cơ sở lưu giữ ban đầu khi thu hoạch',
            },
          });
        }
        const traceToken = randomBytes(24).toString('base64url');
        const traceQr = await tx.traceQr.create({
          data: {
            lotId: lot.id,
            traceToken,
            traceUrl: `${process.env.PUBLIC_TRACE_BASE_URL ?? 'http://localhost:3000/trace'}/${traceToken}`,
          },
        });
        await tx.productionCycle.update({
          where: { id: cycleId },
          data: { version: { increment: 1 } },
        });
        return {
          harvest,
          lot,
          traceQr,
          sensorWindow,
          cycleVersion: cycle.version + 1,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 30000,
      },
    );
  }
}
