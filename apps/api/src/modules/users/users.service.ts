import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateUserDto, UpdateUserStatusDto } from './dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        accountStatus: true,
        createdAt: true,
        updatedAt: true,
        role: { select: { code: true, name: true } },
        organization: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  roles() {
    return this.prisma.role.findMany({ orderBy: { code: 'asc' } });
  }

  async create(input: CreateUserDto) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findFirst({ where: { email } })) {
      throw new ConflictException('Email đã tồn tại');
    }
    const role = await this.prisma.role.findUnique({
      where: { code: input.roleCode },
    });
    if (!role) throw new UnprocessableEntityException('Role không hợp lệ');
    if (role.code !== 'SYSTEM_ADMIN' && !input.organizationId) {
      throw new UnprocessableEntityException(
        'Tài khoản nghiệp vụ phải thuộc một tổ chức',
      );
    }
    return this.prisma.user.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        passwordHash: await hash(input.password, 12),
        roleId: role.id,
        organizationId: input.organizationId,
      },
      select: { id: true, email: true, fullName: true, accountStatus: true },
    });
  }

  async updateStatus(id: string, input: UpdateUserStatusDto) {
    if (!(await this.prisma.user.findUnique({ where: { id } }))) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    return this.prisma.user.update({
      where: { id },
      data: { accountStatus: input.accountStatus },
      select: { id: true, email: true, accountStatus: true, updatedAt: true },
    });
  }
}
