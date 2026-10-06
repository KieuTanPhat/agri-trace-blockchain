import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Actor } from '../trace/trace.service.js';

export type ReportAccessScope = {
  unrestricted: boolean;
  organizationId?: string;
  role: string;
};

@Injectable()
export class ReportAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveScope(
    actor: Actor,
    requestedOrganizationId?: string,
  ): Promise<ReportAccessScope> {
    if (['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)) {
      if (requestedOrganizationId) {
        await this.assertOrganizationExists(
          requestedOrganizationId,
        );
      }

      return {
        unrestricted: !requestedOrganizationId,
        organizationId: requestedOrganizationId,
        role: actor.role,
      };
    }

    if (!actor.organizationId) {
      throw new ForbiddenException(
        'Tài khoản không thuộc tổ chức nào',
      );
    }

    if (
      requestedOrganizationId &&
      requestedOrganizationId !== actor.organizationId
    ) {
      throw new ForbiddenException(
        'Không có quyền xem báo cáo của tổ chức khác',
      );
    }

    await this.assertOrganizationExists(actor.organizationId);

    return {
      unrestricted: false,
      organizationId: actor.organizationId,
      role: actor.role,
    };
  }

  private async assertOrganizationExists(
    organizationId: string,
  ): Promise<void> {
    const organization =
      await this.prisma.organization.findUnique({
        where: {
          id: organizationId,
        },
        select: {
          id: true,
        },
      });

    if (!organization) {
      throw new NotFoundException(
        'Không tìm thấy tổ chức cần lập báo cáo',
      );
    }
  }
}