import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';

describe('RolesGuard explicit allowlists', () => {
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { role: 'SYSTEM_ADMIN' } }),
    }),
  } as unknown as ExecutionContext;

  it('permits a route with no role metadata', () => {
    const guard = new RolesGuard({
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies a route with an explicitly empty allowlist', () => {
    const guard = new RolesGuard({
      getAllAndOverride: vi.fn().mockReturnValue([]),
    } as unknown as Reflector);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies Admin on a farmer command', () => {
    const guard = new RolesGuard({
      getAllAndOverride: vi.fn().mockReturnValue(['FARM_STAFF']),
    } as unknown as Reflector);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
