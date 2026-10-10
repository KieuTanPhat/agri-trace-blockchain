import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Actor } from '../trace/trace.service.js';

@Injectable()
export class ComplianceAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: Actor) {
    if (!['SYSTEM_ADMIN', 'COMPLIANCE_REVIEWER'].includes(actor.role))
      throw new ForbiddenException('Không có quyền xem phân công');
    return this.prisma.complianceAssignment.findMany({
      where:
        actor.role === 'SYSTEM_ADMIN'
          ? {}
          : {
              reviewerUserId:
                actor.sub ?? '00000000-0000-0000-0000-000000000000',
              revokedAt: null,
            },
      include: {
        farm: { select: { id: true, name: true } },
        audits: { orderBy: { recordedAt: 'asc' } },
      },
      orderBy: { grantedAt: 'desc' },
    });
  }

  async grant(
    input: { reviewerUserId: string; farmId: string; reason: string },
    actor: Actor,
  ) {
    this.assertAdmin(actor);
    return commandTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${input.reviewerUserId}:${input.farmId}`}, 0))`;
      const reviewer = await tx.user.findUnique({
        where: { id: input.reviewerUserId },
        include: { role: true, organization: true },
      });
      const farm = await tx.farm.findUnique({
        where: { id: input.farmId },
        include: { organization: true },
      });
      if (
        !reviewer ||
        reviewer.accountStatus !== 'ACTIVE' ||
        reviewer.role.code !== 'COMPLIANCE_REVIEWER' ||
        reviewer.organization?.type !== 'AUDITOR' ||
        reviewer.organization.status !== 'ACTIVE' ||
        !farm ||
        farm.status !== 'ACTIVE' ||
        farm.organization.status !== 'ACTIVE'
      )
        throw new UnprocessableEntityException(
          'Reviewer hoặc nông trại không hợp lệ/không hoạt động',
        );
      if (
        await tx.complianceAssignment.findFirst({
          where: {
            reviewerUserId: input.reviewerUserId,
            farmId: input.farmId,
            revokedAt: null,
          },
        })
      )
        throw new ConflictException('Phân công đang hoạt động đã tồn tại');
      return tx.complianceAssignment.create({
        data: {
          reviewerUserId: input.reviewerUserId,
          farmId: input.farmId,
          audits: {
            create: {
              action: 'GRANTED',
              actorUserId: actor.sub!,
              reason: this.reason(input.reason),
            },
          },
        },
      });
    });
  }

  async revoke(id: string, reason: string, actor: Actor) {
    this.assertAdmin(actor);
    return commandTransaction(this.prisma, async (tx) => {
      const assignment = await tx.complianceAssignment.findUnique({
        where: { id },
      });
      if (!assignment) throw new NotFoundException('Không tìm thấy phân công');
      const result = await tx.complianceAssignment.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1)
        throw new ConflictException('Phân công đã bị thu hồi');
      await tx.complianceAssignmentAudit.create({
        data: {
          assignmentId: id,
          action: 'REVOKED',
          actorUserId: actor.sub!,
          reason: this.reason(reason),
        },
      });
      return tx.complianceAssignment.findUniqueOrThrow({ where: { id } });
    });
  }

  private assertAdmin(actor: Actor): void {
    if (actor.role !== 'SYSTEM_ADMIN' || !actor.sub)
      throw new ForbiddenException('Chỉ Admin quản lý phân công');
  }
  private reason(value: string): string {
    if (!value?.trim() || value.trim().length > 1000)
      throw new UnprocessableEntityException('Cần lý do từ 1 đến 1000 ký tự');
    return value.trim();
  }
}
