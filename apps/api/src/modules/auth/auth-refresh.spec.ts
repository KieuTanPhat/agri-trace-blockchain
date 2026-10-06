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
      where: { id: 'session-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(create).toHaveBeenCalledOnce();
  });
});
