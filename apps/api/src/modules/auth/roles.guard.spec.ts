import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ROLES_KEY } from './roles.decorator.js';
import { COMMAND_POLICY_KEY } from './command-policy.decorator.js';

describe('RolesGuard explicit allowlists', () => {
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { role: 'SYSTEM_ADMIN' } }),
    }),
  } as unknown as ExecutionContext;

  it('permits a route with no role metadata', () => {
    const guard = new RolesGuard(
      {
        getAllAndOverride: vi.fn().mockReturnValue(undefined),
      } as unknown as Reflector,
      {} as PrismaService,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies a route with an explicitly empty allowlist', () => {
    const guard = new RolesGuard(
      {
        getAllAndOverride: vi.fn().mockReturnValue([]),
      } as unknown as Reflector,
      {} as PrismaService,
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies Admin on a farmer command', () => {
    const guard = new RolesGuard(
      {
        getAllAndOverride: vi.fn().mockReturnValue(['FARM_STAFF']),
      } as unknown as Reflector,
      {} as PrismaService,
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

describe('RolesGuard scoped candidates before DTO validation', () => {
  function fixture(
    method: string,
    requiredRoles: string[],
    policy: string[] = [],
  ) {
    const findFirst = vi.fn();
    const guard = new RolesGuard(
      {
        getAllAndOverride: vi.fn((key: string) =>
          key === ROLES_KEY
            ? requiredRoles
            : key === COMMAND_POLICY_KEY
              ? policy
              : undefined,
        ),
      } as unknown as Reflector,
      { scopedRoleGrant: { findFirst } } as unknown as PrismaService,
    );
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          user: { sub: 'user', role: 'AUDITOR', organizationId: 'org' },
          body: {},
        }),
      }),
    } as unknown as ExecutionContext;
    return { guard, context, findFirst };
  }

  it('rejects an Auditor with no current business candidate before validating an empty write body', async () => {
    const { guard, context, findFirst } = fixture('POST', ['FARM_STAFF']);
    findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permits DTO validation for a current scoped role despite the authenticated global role', async () => {
    const { guard, context, findFirst } = fixture('POST', ['FARM_STAFF']);
    findFirst.mockResolvedValue({ id: 'grant' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('never uses command metadata to bypass a read route role requirement', () => {
    const { guard, context, findFirst } = fixture('GET', ['FARM_STAFF']);
    findFirst.mockResolvedValue({ id: 'grant' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('requires an eligible scoped candidate for the explicit independent reviewer command', async () => {
    const { guard, context, findFirst } = fixture(
      'POST',
      ['SYSTEM_ADMIN'],
      ['COMPLIANCE_REVIEWER'],
    );
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'review-grant' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
