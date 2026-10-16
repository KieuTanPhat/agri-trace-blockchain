import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../modules/auth/auth.types.js';
import { ROLES_KEY } from './roles.decorator.js';
import {
  COMMAND_POLICY_KEY,
  COMMAND_RECOVERY_READ_KEY,
  type BusinessCommandRole,
} from './command-policy.decorator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
const CAPABILITIES = {
  FARM_STAFF: 'FARM',
  TRANSPORTER: 'TRANSPORTER',
  RETAILER: 'RETAILER',
  COMPLIANCE_REVIEWER: 'AUDITOR',
} as const;

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles === undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new UnauthorizedException('Chưa xác thực người dùng');
    }
    if (requiredRoles.length === 0)
      throw new ForbiddenException(
        'Bạn không có quyền thực hiện chức năng này',
      );

    if (requiredRoles.includes(request.user.role)) return true;
    const policy = this.reflector.getAllAndOverride<BusinessCommandRole[]>(
      COMMAND_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );
    const recoveryRead =
      request.method === 'GET' &&
      this.reflector.getAllAndOverride<boolean>(COMMAND_RECOVERY_READ_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    if (
      policy === undefined ||
      (!['POST', 'PATCH'].includes(request.method) && !recoveryRead) ||
      request.user.role === 'SYSTEM_ADMIN' ||
      !request.user.organizationId
    )
      throw new ForbiddenException(
        'Bạn không có quyền thực hiện chức năng này',
      );
    const roles = (policy.length ? policy : requiredRoles).filter(
      (role): role is BusinessCommandRole => role in CAPABILITIES,
    );
    if (!roles.length)
      throw new ForbiddenException(
        'Bạn không có quyền thực hiện chức năng này',
      );
    // A current candidate role permits DTO validation, not the domain write.
    // authorizeCommand still resolves the exact resource/grant under locks.
    return this.prisma.scopedRoleGrant
      .findFirst({
        where: {
          userId: request.user.sub,
          organizationId: request.user.organizationId,
          scope: 'CHAIN',
          revokedAt: null,
          user: {
            accountStatus: 'ACTIVE',
            organizationId: request.user.organizationId,
          },
          membership: { status: 'ACTIVE' },
          chain: {
            businessProfile: { is: { state: 'ACTIVE', scopeVersion: 1 } },
          },
          OR: roles.map((role) => ({
            role,
            organization: {
              status: 'ACTIVE',
              capabilities: {
                some: { code: CAPABILITIES[role], revokedAt: null },
              },
            },
          })),
        },
        select: { id: true },
      })
      .then((grant) => {
        if (!grant)
          throw new ForbiddenException(
            'Bạn không có quyền thực hiện chức năng này',
          );
        return true;
      });
  }
}
