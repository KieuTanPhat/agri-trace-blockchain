import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import type { CreateCertificateDto, CreateInspectionDto } from './dto.js';

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
              { lot: { farmOrgId: actor.organizationId ?? undefined } },
              {
                lot: {
                  shipment: {
                    transporterOrgId: actor.organizationId ?? undefined,
                  },
                },
              },
              {
                lot: {
                  shipment: {
                    retailerOrgId: actor.organizationId ?? undefined,
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
    await this.assertAuditor(actor);
    if (!(await this.prisma.lot.findUnique({ where: { id: input.lotId } })))
      throw new NotFoundException('Không tìm thấy lô cần thanh tra');
    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          lotId: input.lotId,
          inspectorOrgId: actor.organizationId,
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
    const unrestricted = ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role);
    return this.prisma.certificate.findMany({
      where: {
        lotId: lotId || undefined,
        cycleId: cycleId || undefined,
        OR: unrestricted
          ? undefined
          : [
              { lot: { farmOrgId: actor.organizationId ?? undefined } },
              { cycle: { farmOrgId: actor.organizationId ?? undefined } },
              {
                lot: {
                  shipment: {
                    transporterOrgId: actor.organizationId ?? undefined,
                  },
                },
              },
              {
                lot: {
                  shipment: {
                    retailerOrgId: actor.organizationId ?? undefined,
                  },
                },
              },
            ],
      },
      orderBy: { issueDate: 'desc' },
    });
  }

  async createCertificate(input: CreateCertificateDto, actor: Actor) {
    await this.assertAuditor(actor);
    if (Boolean(input.lotId) === Boolean(input.cycleId))
      throw new UnprocessableEntityException(
        'Chứng chỉ phải gắn với đúng một Lot hoặc ProductionCycle',
      );
    if (
      input.lotId &&
      !(await this.prisma.lot.findUnique({ where: { id: input.lotId } }))
    )
      throw new NotFoundException('Không tìm thấy lô');
    if (
      input.cycleId &&
      !(await this.prisma.productionCycle.findUnique({
        where: { id: input.cycleId },
      }))
    )
      throw new NotFoundException('Không tìm thấy chu kỳ sản xuất');
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
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'CERTIFICATE',
        entityId: certificate.id,
        lotId: input.lotId,
        cycleId: input.cycleId,
        eventType: 'CERTIFICATE_ISSUED',
        actor,
        businessData: {
          type: certificate.type,
          issuer: certificate.issuer,
          documentHash: certificate.documentHash,
          isPublic: certificate.isPublic,
        },
      });
      return certificate;
    });
  }

  private async assertAuditor(actor: Actor) {
    if (actor.role === 'SYSTEM_ADMIN') return;
    if (actor.role !== 'AUDITOR' || !actor.organizationId)
      throw new ForbiddenException('Chỉ đơn vị thanh tra được phép thao tác');
    const organization = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
    });
    if (!organization || organization.type !== 'AUDITOR')
      throw new ForbiddenException('Tổ chức thanh tra không hợp lệ');
  }
}
