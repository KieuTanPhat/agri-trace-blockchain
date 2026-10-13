import {
  ExecutionContext,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

describe('Current account authorization', () => {
  const id = 'd6212d56-a3b2-4d54-9779-cc8507a6bd53';
  const sid = '4f0f4d55-5a20-4a75-a583-1f247ca86cb6';
  const jwt = new JwtService({
    secret: 'guard-tests-only-secret',
  });

  const findUnique = vi.fn();

  const prisma = {
    user: {
      findUnique,
      create: vi.fn(),
    },
    refreshSession: { findFirst: vi.fn() },
  };

  const guard = new JwtAuthGuard(jwt, prisma as unknown as PrismaService);

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.refreshSession.findFirst.mockResolvedValue({ id: sid });
  });

  function context() {
    const request = {
      headers: {
        authorization: `Bearer ${jwt.sign({
          sub: id,
          sid,
          role: 'SYSTEM_ADMIN',
          email: 'old@example.com',
        })}`,
      },
    } as AuthenticatedRequest;

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;

    return { request, ctx };
  }

  it('uses current DB role and organization instead of stale JWT claims', async () => {
    const current = {
      id,
      email: 'new@example.com',
      roleId: '8fb589c9-e423-4b3e-a492-a521b9094166',
      role: {
        code: 'FARM_STAFF',
      },
      organizationId: '631e9648-174d-48a0-9494-353bda8775da',
      organization: { status: 'ACTIVE' },
      accountStatus: 'ACTIVE',
    };

    findUnique.mockResolvedValue(current);

    const { request, ctx } = context();

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(request.user).toEqual({
      sub: id,
      sid,
      email: current.email,
      role: current.role.code,
      organizationId: current.organizationId,
      accountStatus: 'ACTIVE',
    });

    current.accountStatus = 'LOCKED';

    await expect(guard.canActivate(context().ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    current.accountStatus = 'ACTIVE';
    current.organization.status = 'INACTIVE';
    await expect(guard.canActivate(context().ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a revoked session even when its JWT has not expired', async () => {
    findUnique.mockResolvedValue({
      id,
      email: 'staff@example.com',
      role: { code: 'FARM_STAFF' },
      organizationId: null,
      accountStatus: 'ACTIVE',
    });
    prisma.refreshSession.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(context().ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('does not authorize a request when the database fails', async () => {
    const failure = new Error('Database unavailable');

    findUnique.mockRejectedValue(failure);

    const { request, ctx } = context();

    await expect(guard.canActivate(ctx)).rejects.toBe(failure);
    expect(request.user).toBeUndefined();
  });

  it('temporarily disables public registration', () => {
    const service = new AuthService(prisma as unknown as PrismaService, jwt);

    expect(() =>
      service.register({
        email: 'new@example.com',
        password: 'test-password',
      }),
    ).toThrow(NotImplementedException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
