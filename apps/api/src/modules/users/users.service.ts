import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
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
    const passwordHash = await hash(input.password, 12);
    return commandTransaction(this.prisma, async (tx) => {
      const email = input.email.trim().toLowerCase();
      if (await tx.user.findFirst({ where: { email } })) {
        throw new ConflictException('Email đã tồn tại');
      }
      const role = await tx.role.findUnique({
        where: { code: input.roleCode },
      });
      if (!role) throw new UnprocessableEntityException('Role không hợp lệ');
      if (role.code !== 'SYSTEM_ADMIN' && !input.organizationId) {
        throw new UnprocessableEntityException(
          'Tài khoản nghiệp vụ phải thuộc một tổ chức',
        );
      }
      if (
        input.organizationId &&
        !(await tx.organization.findUnique({
          where: { id: input.organizationId },
        }))
      ) {
        throw new UnprocessableEntityException('Organization does not exist');
      }
      if (role.code === 'COMPLIANCE_REVIEWER') {
        const organization = await tx.organization.findUnique({
          where: { id: input.organizationId! },
        });
        if (
          !organization ||
          organization.type !== 'AUDITOR' ||
          organization.status !== 'ACTIVE'
        )
          throw new UnprocessableEntityException(
            'Reviewer phải thuộc tổ chức AUDITOR đang hoạt động',
          );
      }
      return tx.user.create({
        data: {
          email,
          fullName: input.fullName.trim(),
          passwordHash,
          roleId: role.id,
          organizationId: input.organizationId,
        },
        select: { id: true, email: true, fullName: true, accountStatus: true },
      });
    });
  }

  async updateStatus(id: string, input: UpdateUserStatusDto) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.user.findUnique({ where: { id } }))) {
        throw new NotFoundException('Không tìm thấy người dùng');
      }
      const user = await tx.user.update({
        where: { id },
        data: { accountStatus: input.accountStatus },
        select: { id: true, email: true, accountStatus: true, updatedAt: true },
      });
      if (input.accountStatus !== 'ACTIVE') {
        await tx.refreshSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return user;
    });
  }
}
