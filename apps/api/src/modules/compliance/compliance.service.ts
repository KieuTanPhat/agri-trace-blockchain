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
    const unrestricted = ['SYSTEM_ADMIN', 'AUDITOR', 'CERTIFICATE_REVIEWER'].includes(actor.role);
    return this.prisma.inspection.findMany({
      where: {
        lotId: lotId || undefined,
        OR: unrestricted
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
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    const lot = await this.prisma.lot.findUnique({
      where: { id: input.lotId },
      select: { farmOrgId: true },
    });
    if (!lot) throw new NotFoundException('Không tìm thấy lô cần kiểm tra');
    if (lot.farmOrgId !== actor.organizationId)
      throw new ForbiddenException('Lô không thuộc tổ chức của người dùng');
    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          lotId: input.lotId,
          inspectorOrgId: actor.organizationId!,
          result: input.result,
          note: input.note,
          inspectedAt: new Date(input.inspectedAt),
          evidenceRef: input.evidenceRef,
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'INSPECTION',
        entityId: inspection.id,
        lotId: input.lotId,
        eventType: 'INSPECTION_RECORDED',
        eventTime: inspection.inspectedAt,
        actor,
        businessData: {
          result: inspection.result,
          evidenceRef: inspection.evidenceRef ?? null,
        },
      });
      return inspection;
    });
  }

  listCertificates(actor: Actor, lotId?: string, cycleId?: string) {
    const unrestricted = ['SYSTEM_ADMIN', 'AUDITOR', 'CERTIFICATE_REVIEWER'].includes(actor.role);
    return this.prisma.certificate.findMany({
      where: {
        lotId: lotId || undefined,
        cycleId: cycleId || undefined,
        OR: unrestricted
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
    await this.assertCertificateSubmissionAccess(input, actor);
    return this.prisma.$transaction(async (tx) => {
      const certificate = await tx.certificate.create({
        data: {
          lotId: input.lotId,
          cycleId: input.cycleId,
          type: input.type,
          issuer: input.issuer,
          issueDate: new Date(input.issueDate),
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
          documentRef: input.documentRef,
          documentHash: input.documentHash,
          isPublic: input.isPublic ?? false,
          status: 'PENDING',
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'CERTIFICATE',
        entityId: certificate.id,
        lotId: input.lotId,
        cycleId: input.cycleId,
        eventType: 'CERTIFICATE_SUBMITTED',
        actor,
        businessData: {
          type: certificate.type,
          issuer: certificate.issuer,
          documentHash: certificate.documentHash,
          isPublic: certificate.isPublic,
          status: certificate.status,
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
    await this.assertCertificateReviewer(actor);
    const certificate = await this.prisma.certificate.findUnique({
      where: { id: certificateId },
    });
    if (!certificate) throw new NotFoundException('Không tìm thấy chứng chỉ');
    if (certificate.status !== 'PENDING')
      throw new ConflictException('Chứng chỉ đã được xét duyệt');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.certificate.updateMany({
        where: { id: certificateId, status: 'PENDING' },
        data: {
          status: input.status,
          reviewedBy: actor.sub,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote,
        },
      });
      if (updated.count !== 1)
        throw new ConflictException('Chứng chỉ đã được xét duyệt');
      const reviewed = await tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'CERTIFICATE',
        entityId: reviewed.id,
        lotId: reviewed.lotId ?? undefined,
        cycleId: reviewed.cycleId ?? undefined,
        eventType: input.status === 'APPROVED'
          ? 'CERTIFICATE_APPROVED'
          : 'CERTIFICATE_REJECTED',
        actor,
        businessData: {
          documentHash: reviewed.documentHash,
          status: reviewed.status,
          reviewNote: reviewed.reviewNote ?? null,
        },
      });
      return reviewed;
    });
  }

  private async assertCertificateSubmissionAccess(
    input: CreateCertificateDto,
    actor: Actor,
  ) {
    if (input.lotId) {
      const lot = await this.prisma.lot.findUnique({
        where: { id: input.lotId },
        select: { farmOrgId: true },
      });
      if (!lot) throw new NotFoundException('Không tìm thấy lô');
      if (lot.farmOrgId !== actor.organizationId)
        throw new ForbiddenException('Lô không thuộc tổ chức của người dùng');
      return;
    }

    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id: input.cycleId },
      select: { farmOrgId: true },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy chu kỳ sản xuất');
    if (cycle.farmOrgId !== actor.organizationId)
      throw new ForbiddenException('Chu kỳ không thuộc tổ chức của người dùng');
  }

  private async assertCertificateReviewer(actor: Actor) {
    if (actor.role !== 'CERTIFICATE_REVIEWER' || !actor.organizationId)
      throw new ForbiddenException('Chỉ người kiểm tra hồ sơ được phép xét duyệt');
    const organization = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { type: true, status: true },
    });
    if (!organization || organization.type !== 'AUDITOR' || organization.status !== 'ACTIVE')
      throw new ForbiddenException('Tổ chức kiểm tra hồ sơ không hợp lệ');
  }
}
