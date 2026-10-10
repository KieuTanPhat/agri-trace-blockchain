import {
  assertBusinessActor,
  FARM_WRITE_ROLES,
  COMPLIANCE_REVIEW_ROLES,
} from '../auth/business-write.policy.js';
import {
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  commandTransaction,
  lockAggregate,
} from '../../common/idempotency/command-transaction.js';
import {
  assignedFarmWhere,
  assertAssignedFarm,
} from '../auth/compliance-scope.js';
import type { Prisma, Certificate } from '../../generated/prisma/client.js';
import { normalizeExpiryDate } from '../../common/expiry-date.js';
import { businessTimestamp } from '../../common/timestamp.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import type {
  CreateCertificateDto,
  CreateInspectionDto,
  ReviewCertificateDto,
} from './dto.js';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: TraceService,
  ) {}

  listInspections(actor: Actor, lotId?: string) {
    const unrestricted = ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role);
    return this.prisma.inspection.findMany({
      where: {
        lotId: lotId || undefined,
        ...(actor.role === 'COMPLIANCE_REVIEWER'
          ? { lot: { harvest: { cycle: { farm: assignedFarmWhere(actor) } } } }
          : {}),
        OR: unrestricted
          ? undefined
          : actor.role === 'COMPLIANCE_REVIEWER'
            ? undefined
            : [
                {
                  lot: {
                    farmOrgId:
                      actor.organizationId ??
                      '00000000-0000-0000-0000-000000000000',
                  },
                },
                {
                  lot: {
                    shipment: {
                      transporterOrgId:
                        actor.organizationId ??
                        '00000000-0000-0000-0000-000000000000',
                    },
                  },
                },
                {
                  lot: {
                    shipment: {
                      retailerOrgId:
                        actor.organizationId ??
                        '00000000-0000-0000-0000-000000000000',
                    },
                  },
                },
              ],
      },
      include: {
        organization: { select: { id: true, name: true, type: true } },
        lot: { select: { id: true, lotCode: true, currentState: true } },
      },
      orderBy: { inspectedAt: 'desc' },
    });
  }

  async createInspection(input: CreateInspectionDto, actor: Actor) {
    assertBusinessActor(actor, COMPLIANCE_REVIEW_ROLES);
    this.assertCorrectionInput(input);
    const inspectedAt = businessTimestamp(
      input.inspectedAt,
      'Thời gian kiểm định',
    );
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', input.lotId);
      const subject = await this.subject(tx, input);
      await assertAssignedFarm(tx, actor, subject.farmId, true);
      let supersedesEventId: string | undefined;
      if (input.supersedesId) {
        const previous = await tx.inspection.findUnique({
          where: { id: input.supersedesId },
          include: { replacement: { select: { id: true } } },
        });
        if (!previous || previous.lotId !== input.lotId)
          throw new UnprocessableEntityException(
            'Bản sửa phải giữ nguyên Lot của inspection',
          );
        if (previous.replacement)
          throw new ConflictException(
            'Inspection đã có bản sửa; chọn bản mới nhất',
          );
        supersedesEventId = await this.originalEvent(
          tx,
          'INSPECTION',
          previous.id,
          'INSPECTION_RECORDED',
        );
      }
      const inspection = await tx.inspection.create({
        data: {
          lotId: input.lotId,
          inspectorOrgId: actor.organizationId,
          recordedByUserId: actor.sub,
          result: input.result,
          note: input.note,
          inspectedAt,
          evidenceRef: input.evidenceRef,
          supersedesId: input.supersedesId,
          correctionReason: input.correctionReason,
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'INSPECTION',
        entityId: inspection.id,
        lotId: input.lotId,
        cycleId: subject.cycleId,
        eventType: 'INSPECTION_RECORDED',
        actor,
        supersedesEventId,
        businessData: {
          result: inspection.result,
          inspectedAt: inspection.inspectedAt.toISOString(),
          note: inspection.note,
          evidenceRef: inspection.evidenceRef,
          supersedesInspectionId: inspection.supersedesId,
          supersedesEventId: supersedesEventId ?? null,
          correctionReason: inspection.correctionReason,
        },
      });
      return inspection;
    });
  }

  listCertificates(actor: Actor, lotId?: string, cycleId?: string) {
    const unrestricted = ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role);
    return this.prisma.certificate.findMany({
      where: {
        lotId: lotId || undefined,
        cycleId: cycleId || undefined,
        OR: unrestricted
          ? undefined
          : actor.role === 'COMPLIANCE_REVIEWER'
            ? [
                {
                  lot: {
                    harvest: { cycle: { farm: assignedFarmWhere(actor) } },
                  },
                },
                { cycle: { farm: assignedFarmWhere(actor) } },
              ]
            : [
                {
                  lot: {
                    farmOrgId:
                      actor.organizationId ??
                      '00000000-0000-0000-0000-000000000000',
                  },
                },
                {
                  cycle: {
                    farmOrgId:
                      actor.organizationId ??
                      '00000000-0000-0000-0000-000000000000',
                  },
                },
                {
                  lot: {
                    shipment: {
                      transporterOrgId:
                        actor.organizationId ??
                        '00000000-0000-0000-0000-000000000000',
                    },
                  },
                },
                {
                  lot: {
                    shipment: {
                      retailerOrgId:
                        actor.organizationId ??
                        '00000000-0000-0000-0000-000000000000',
                    },
                  },
                },
              ],
      },
      orderBy: { issueDate: 'desc' },
    });
  }

  async createCertificate(input: CreateCertificateDto, actor: Actor) {
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    if (Boolean(input.lotId) === Boolean(input.cycleId))
      throw new UnprocessableEntityException(
        'Chứng chỉ phải gắn với đúng một Lot hoặc ProductionCycle',
      );
    this.assertCorrectionInput(input);
    if (!/^[a-f0-9]{64}$/.test(input.documentHash))
      throw new UnprocessableEntityException(
        'documentHash phải là SHA-256 chữ thường',
      );
    const issueDate = normalizeExpiryDate(input.issueDate);
    const expiryDate = input.expiryDate
      ? normalizeExpiryDate(input.expiryDate)
      : null;
    if (expiryDate && expiryDate < issueDate)
      throw new UnprocessableEntityException(
        'Ngày hết hạn chứng nhận phải từ ngày cấp',
      );
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(
        tx,
        input.lotId ? 'lot' : 'cycle',
        input.lotId ?? input.cycleId!,
      );
      const subject = await this.subject(tx, input);
      if (subject.farmOrgId !== actor.organizationId)
        throw new ForbiddenException('Chứng nhận nằm ngoài tổ chức Farm');
      let supersedesEventId: string | undefined;
      if (input.supersedesId) {
        const previous = await tx.certificate.findUnique({
          where: { id: input.supersedesId },
          include: {
            replacements: {
              where: { status: { in: ['PENDING', 'APPROVED'] } },
              select: { id: true },
            },
          },
        });
        if (
          !previous ||
          previous.lotId !== (input.lotId ?? null) ||
          previous.cycleId !== (input.cycleId ?? null)
        )
          throw new UnprocessableEntityException(
            'Bản thay thế phải giữ nguyên subject chứng nhận',
          );
        if (previous.status !== 'APPROVED' || previous.replacements.length)
          throw new ConflictException(
            'Chỉ thay thế chứng nhận đang hiệu lực, chưa có bản thay thế chờ duyệt',
          );
        supersedesEventId = await this.originalEvent(
          tx,
          'CERTIFICATE',
          previous.id,
          'CERTIFICATE_SUBMITTED',
        );
      }
      const certificate = await tx.certificate.create({
        data: {
          lotId: input.lotId,
          cycleId: input.cycleId,
          type: input.type,
          issuer: input.issuer,
          issueDate,
          expiryDate,
          documentRef: input.documentRef,
          documentHash: input.documentHash,
          isPublic: input.isPublic ?? false,
          status: 'PENDING',
          submittedByUserId: actor.sub,
          supersedesId: input.supersedesId,
          correctionReason: input.correctionReason,
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'CERTIFICATE',
        entityId: certificate.id,
        lotId: input.lotId,
        cycleId: subject.cycleId,
        eventType: 'CERTIFICATE_SUBMITTED',
        actor,
        supersedesEventId,
        businessData: {
          type: certificate.type,
          issuer: certificate.issuer,
          documentHash: certificate.documentHash,
          isPublic: certificate.isPublic,
          status: certificate.status,
          issueDate: certificate.issueDate.toISOString().slice(0, 10),
          expiryDate:
            certificate.expiryDate?.toISOString().slice(0, 10) ?? null,
          documentRef: certificate.documentRef,
          supersedesCertificateId: certificate.supersedesId,
          supersedesEventId: supersedesEventId ?? null,
          correctionReason: certificate.correctionReason,
        },
      });
      return certificate;
    });
  }

  async reviewCertificate(
    certificateId: string,
    input: ReviewCertificateDto,
    actor: Actor,
  ) {
    assertBusinessActor(actor, COMPLIANCE_REVIEW_ROLES);
    if (!['APPROVED', 'REJECTED'].includes(input.status))
      throw new UnprocessableEntityException(
        'Quyết định chứng nhận không hợp lệ',
      );
    return commandTransaction(this.prisma, async (tx) => {
      const initial = await tx.certificate.findUnique({
        where: { id: certificateId },
      });
      if (!initial) throw new NotFoundException('Không tìm thấy chứng nhận');
      await lockAggregate(
        tx,
        initial.lotId ? 'lot' : 'cycle',
        initial.lotId ?? initial.cycleId!,
      );
      const certificate = await tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
      });
      const subject = await this.subject(tx, certificate);
      await assertAssignedFarm(tx, actor, subject.farmId, true);
      if (
        certificate.status !== 'PENDING' ||
        certificate.version !== input.version
      )
        throw new ConflictException(
          'Chứng nhận đã được quyết định hoặc version đã thay đổi',
        );
      await this.assertNoSelfReview(tx, certificate, actor);
      if (certificate.supersedesId) {
        const predecessor = await tx.certificate.findUnique({
          where: { id: certificate.supersedesId },
          include: {
            replacements: {
              where: { status: 'APPROVED' },
              select: { id: true },
            },
          },
        });
        if (
          !predecessor ||
          predecessor.status !== 'APPROVED' ||
          predecessor.replacements.length
        )
          throw new ConflictException(
            'Chứng nhận gốc đã có bản thay thế hiệu lực',
          );
      }
      const reviewedAt = new Date();
      const changed = await tx.certificate.updateMany({
        where: { id: certificateId, status: 'PENDING', version: input.version },
        data: {
          status: input.status,
          reviewedBy: actor.sub,
          reviewedAt,
          reviewNote: input.reviewNote,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('Chứng nhận đã được quyết định');
      await this.trace.createInTransaction(tx, {
        entityType: 'CERTIFICATE',
        entityId: certificateId,
        lotId: certificate.lotId ?? undefined,
        cycleId: subject.cycleId,
        eventType:
          input.status === 'APPROVED'
            ? 'CERTIFICATE_APPROVED'
            : 'CERTIFICATE_REJECTED',
        actor,
        businessData: {
          status: input.status,
          reviewedAt: reviewedAt.toISOString(),
          reviewNote: input.reviewNote ?? null,
          supersedesCertificateId: certificate.supersedesId,
          versionBefore: certificate.version,
          versionAfter: certificate.version + 1,
        },
      });
      return tx.certificate.findUniqueOrThrow({ where: { id: certificateId } });
    });
  }

  private async subject(
    db: Prisma.TransactionClient,
    input: { lotId?: string | null; cycleId?: string | null },
  ) {
    if (Boolean(input.lotId) === Boolean(input.cycleId))
      throw new UnprocessableEntityException(
        'Cần đúng một Lot hoặc ProductionCycle',
      );
    if (input.lotId) {
      const lot = await db.lot.findUnique({
        where: { id: input.lotId },
        include: {
          harvest: {
            include: { cycle: { select: { id: true, farmId: true } } },
          },
        },
      });
      if (!lot) throw new NotFoundException('Không tìm thấy lô');
      return {
        farmOrgId: lot.farmOrgId,
        farmId: lot.harvest.cycle.farmId,
        cycleId: lot.harvest.cycle.id,
      };
    }
    const cycle = await db.productionCycle.findUnique({
      where: { id: input.cycleId! },
      select: { id: true, farmOrgId: true, farmId: true },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy chu kỳ sản xuất');
    return {
      farmOrgId: cycle.farmOrgId,
      farmId: cycle.farmId,
      cycleId: cycle.id,
    };
  }

  private assertCorrectionInput(input: {
    supersedesId?: string;
    correctionReason?: string;
  }) {
    if (
      Boolean(input.supersedesId) !== Boolean(input.correctionReason?.trim()) ||
      (input.correctionReason?.length ?? 0) > 1000
    )
      throw new UnprocessableEntityException(
        'Bản sửa cần supersedesId và lý do đi kèm',
      );
  }

  private async originalEvent(
    db: Prisma.TransactionClient,
    entityType: string,
    entityId: string,
    eventType: string,
  ) {
    const events = await db.traceEvent.findMany({
      where: { entityType, entityId, eventType },
      select: { id: true },
      take: 2,
    });
    if (events.length !== 1)
      throw new ConflictException(
        'Thiếu hoặc trùng evidence gốc; cần đối soát trước khi sửa',
      );
    return events[0].id;
  }

  private async assertNoSelfReview(
    db: Prisma.TransactionClient,
    certificate: Certificate,
    actor: Actor,
  ) {
    const seen = new Set<string>();
    let current: Certificate | null = certificate;
    while (current) {
      if (seen.has(current.id))
        throw new ConflictException('Chuỗi chứng nhận có vòng lặp');
      seen.add(current.id);
      const events = await db.traceEvent.findMany({
        where: {
          entityType: 'CERTIFICATE',
          entityId: current.id,
          eventType: 'CERTIFICATE_SUBMITTED',
        },
        select: { actorUserId: true },
        take: 2,
      });
      if (
        events.length !== 1 ||
        !events[0].actorUserId ||
        (current.submittedByUserId &&
          current.submittedByUserId !== events[0].actorUserId)
      )
        throw new ConflictException(
          'Không xác minh được người nộp gốc; cần đối soát',
        );
      if (events[0].actorUserId === actor.sub)
        throw new ForbiddenException(
          'Reviewer không được duyệt chứng nhận do chính mình nộp',
        );
      current = current.supersedesId
        ? await db.certificate.findUnique({
            where: { id: current.supersedesId },
          })
        : null;
    }
  }
}
