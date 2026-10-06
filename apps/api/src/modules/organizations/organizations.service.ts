import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  async create(input: CreateOrganizationDto) {
    const data = { name: input.name.trim(), type: input.type };
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (await tx.organization.findFirst({ where: data })) {
            throw new ConflictException('Tổ chức cùng tên và loại đã tồn tại');
          }
          return tx.organization.create({ data });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        ['P2002', 'P2034'].includes(String(error.code))
      )
        throw new ConflictException(
          'Dữ liệu trùng hoặc đã thay đổi; hãy tải lại và kiểm tra',
        );
      throw error;
    }
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
