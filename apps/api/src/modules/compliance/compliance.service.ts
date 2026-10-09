import {
  assertBusinessActor,
  FARM_WRITE_ROLES,
  rejectUnassignedComplianceWrite,
} from '../auth/business-write.policy.js';
import {
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
    const unrestricted = ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role);
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

  async createInspection(
    _input: CreateInspectionDto,
    _actor: Actor,
  ): Promise<never> {
    return rejectUnassignedComplianceWrite();
  }

  listCertificates(actor: Actor, lotId?: string, cycleId?: string) {
    const unrestricted = ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role);
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
    _certificateId: string,
    _input: ReviewCertificateDto,
    _actor: Actor,
  ): Promise<never> {
    return rejectUnassignedComplianceWrite();
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
}
