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
    const existing = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy tổ chức');
    return this.prisma.organization.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        status: input.status,
      },
    });
  }
}
