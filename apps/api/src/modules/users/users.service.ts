import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateUserDto,
  UpdateUserAssignmentDto,
  UpdateUserStatusDto,
} from './dto.js';

const ORGANIZATION_TYPE_BY_ROLE: Record<string, string> = {
  FARM_STAFF: 'FARM',
  TRANSPORTER: 'TRANSPORTER',
  RETAILER: 'RETAILER',
  AUDITOR: 'AUDITOR',
};

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
    const fullName = input.fullName.trim();

    if (!fullName) {
      throw new UnprocessableEntityException('Họ tên không được để trống');
    }

    if (await this.prisma.user.findFirst({ where: { email } })) {
      throw new ConflictException('Email đã tồn tại');
    }

    const assignment = await this.validateAssignment(
      input.roleCode,
      input.organizationId,
    );

    return this.prisma.user.create({
        data: {
          email,
          fullName,
          passwordHash: await hash(input.password, 12),
          roleId: assignment.roleId,
          organizationId: assignment.organizationId,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          organizationId: true,
          accountStatus: true,
          role: {
            select: {
              code: true,
              name: true,
            },
          },
        },
    });
  }

  async updateStatus(id: string, input: UpdateUserStatusDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Không tìm thấy người dùng');
      }

      const user = await tx.user.update({
        where: { id },
        data: { accountStatus: input.accountStatus },
        select: {
          id: true,
          email: true,
          accountStatus: true,
          updatedAt: true,
        },
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

  async updateAssignment(id: string, input: UpdateUserAssignmentDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const assignment = await this.validateAssignment(
      input.roleCode,
      input.organizationId,
    );

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          roleId: assignment.roleId,
          organizationId: assignment.organizationId,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          organizationId: true,
          accountStatus: true,
          role: {
            select: {
              code: true,
              name: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
              status: true,
            },
          },
          updatedAt: true,
        },
      });

      await tx.refreshSession.updateMany({
        where: {
          userId: id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      return user;
    });
  }

  private async validateAssignment(roleCode: string, organizationId?: string | null) {
    const role = await this.prisma.role.findUnique({
      where: { code: roleCode.trim() },
    });

    if (!role) {
      throw new UnprocessableEntityException('Role không hợp lệ');
    }

    if (role.code === 'SYSTEM_ADMIN') {
      if (organizationId) {
        throw new UnprocessableEntityException(
          'Quản trị hệ thống không thuộc một tổ chức cụ thể',
        );
      }

      return {
        roleId: role.id,
        organizationId: null,
      };
    }

    if (!organizationId) {
      throw new UnprocessableEntityException(
        'Tài khoản nghiệp vụ phải thuộc một tổ chức',
      );
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization || organization.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(
        'Tổ chức không tồn tại hoặc không hoạt động',
      );
    }

    const expectedType = ORGANIZATION_TYPE_BY_ROLE[role.code];

    if (!expectedType || organization.type !== expectedType) {
      throw new UnprocessableEntityException(
        'Role không phù hợp với loại tổ chức',
      );
    }

    return {
      roleId: role.id,
      organizationId: organization.id,
    };
  }
}