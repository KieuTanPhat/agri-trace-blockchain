import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateOrganizationDto, UpdateOrganizationDto } from './dto.js';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.organization.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  create(input: CreateOrganizationDto) {
    return this.prisma.organization.create({
      data: { name: input.name.trim(), type: input.type },
    });
  }

  async update(id: string, input: UpdateOrganizationDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.organization.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Không tìm thấy tổ chức');
      const organization = await tx.organization.update({
        where: { id },
        data: { name: input.name?.trim(), status: input.status },
      });
      if (input.status && input.status !== 'ACTIVE') {
        await tx.refreshSession.updateMany({
          where: { user: { organizationId: id }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return organization;
    });
  }
}
