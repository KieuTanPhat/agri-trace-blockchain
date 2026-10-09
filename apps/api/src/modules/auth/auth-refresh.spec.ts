import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService refresh token rotation', () => {
  it('revokes the presented token and returns a different refresh token', async () => {
    const presented = 'r'.repeat(48);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
      refreshSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          familyId: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
          userId: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
          tokenHash: createHash('sha256').update(presented).digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          user: {
            id: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
            email: 'staff@example.com',
            fullName: 'Staff',
            organizationId: null,
            role: { id: 'role-1', code: 'FARM_STAFF', name: 'Farm staff' },
            accountStatus: 'ACTIVE',
          },
        }),
      },
      $transaction: vi.fn(async (callback) =>
        callback({ refreshSession: { updateMany, create } }),
      ),
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService({ secret: 'refresh-test-secret' }),
    );

    const result = await service.refresh({ refreshToken: presented });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).not.toBe(presented);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('allows only one concurrent refresh without revoking the newly issued session', async () => {
    const token = 'r'.repeat(48);
    const familyId = 'd6212d56-a3b2-4d54-9779-cc8507a6bd53';
    let oldRevoked = false;
    let oldRevokedAt: Date | null = null;
    const session = {
      id: familyId,
      familyId,
      userId: familyId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: familyId,
        email: 'staff@example.com',
        role: { code: 'FARM_STAFF' },
        organizationId: null,
        accountStatus: 'ACTIVE',
      },
    };
    const updateMany = vi.fn(async ({ where }: { where: { id?: string; familyId?: string } }) => {
      if (where.familyId) {
        return { count: 1 };
      }
      if (oldRevoked) return { count: 0 };
      oldRevoked = true;
      oldRevokedAt = new Date();
      return { count: 1 };
    });
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
      refreshSession: {
        findUnique: vi.fn(async () => ({ ...session, revokedAt: oldRevokedAt })),
        updateMany,
      },
      $transaction: vi.fn(async (callback) =>
        callback({ refreshSession: { updateMany, create } }),
      ),
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService({ secret: 'refresh-test-secret' }),
    );

    const results = await Promise.allSettled([
      service.refresh({ refreshToken: token }),
      service.refresh({ refreshToken: token }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(updateMany.mock.calls.some(([input]) => input.where.familyId)).toBe(false);
  });

  it('rejects replay of an already rotated token and revokes its family', async () => {
    const familyId = 'd6212d56-a3b2-4d54-9779-cc8507a6bd53';
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      refreshSession: {
        findUnique: vi.fn().mockResolvedValue({
          familyId,
          revokedAt: new Date(Date.now() - 10_000),
        }),
        updateMany,
      },
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService({ secret: 'refresh-test-secret' }),
    );
    await expect(service.refresh({ refreshToken: 'old-token' })).rejects.toMatchObject({
      status: 401,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { familyId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
