import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from '../platform-governance/platform-audit.js';
import type { PlatformCommandActor } from '../users/users.service.js';
import type { CreateOrganizationDto, UpdateOrganizationDto } from './dto.js';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.organization.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  create(actor: PlatformCommandActor, input: CreateOrganizationDto) {
    if (input.type !== 'AUDITOR')
      throw new UnprocessableEntityException(
        'Doanh nghiệp phải đăng ký và được xét duyệt',
      );
    return commandTransaction(this.prisma, async (tx) => {
      await lockPlatformAudit(tx);
      const organization = await tx.organization.create({
        data: { name: input.name.trim(), type: input.type },
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'ORGANIZATION_CREATED',
        subjectType: 'ORGANIZATION',
        subjectId: organization.id,
        organizationId: organization.id,
        details: { type: organization.type },
      });
      return organization;
    });
  }

  async update(
    actor: PlatformCommandActor,
    id: string,
    input: UpdateOrganizationDto,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      await lockPlatformAudit(tx);
      // Same lock the session helpers take before reading org status, so a
      // concurrent login/refresh cannot slip through a disable.
      await tx.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${id}::uuid FOR UPDATE`;
      const existing = await tx.organization.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Không tìm thấy tổ chức');
      if (existing.version !== input.version)
        throw new ConflictException('Tổ chức đã thay đổi; tải lại trạng thái');
      if (!input.name && !input.status)
        throw new UnprocessableEntityException('Không có thay đổi để áp dụng');
      const organization = await tx.organization.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          status: input.status,
          version: { increment: 1 },
        },
      });
      let revoked = 0;
      if (input.status && input.status !== 'ACTIVE') {
        revoked = (
          await tx.refreshSession.updateMany({
            where: { user: { organizationId: id }, revokedAt: null },
            data: { revokedAt: new Date() },
          })
        ).count;
      }
      await appendPlatformAudit(tx, {
        actor,
        action:
          input.status && input.status !== existing.status
            ? 'ORGANIZATION_STATUS_CHANGED'
            : 'ORGANIZATION_UPDATED',
        subjectType: 'ORGANIZATION',
        subjectId: id,
        organizationId: id,
        reason: input.reason,
        details: {
          statusFrom: existing.status,
          statusTo: organization.status,
          renamed: input.name !== undefined && input.name !== existing.name,
          sessionsRevoked: revoked,
        },
      });
      return organization;
    });
  }
}
