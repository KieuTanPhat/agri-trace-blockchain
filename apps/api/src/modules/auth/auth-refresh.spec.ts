import { JwtService } from '@nestjs/jwt';
import { vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { sessionFamilyWhere } from './session-family.js';

describe('AuthService refresh token rotation', () => {
  const id = 'd6212d56-a3b2-4d54-9779-cc8507a6bd53';
  function fixture(overrides: Record<string, unknown> = {}) {
    const session = {
      id,
      familyId: id,
      userId: id,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id,
        email: 'staff@example.com',
        role: { code: 'FARM_STAFF' },
        organizationId: null,
        accountStatus: 'ACTIVE',
      },
      ...overrides,
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      refreshSession: {
        findUnique: vi.fn().mockResolvedValue(session),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      refreshSession: { findUnique: vi.fn().mockResolvedValue(session) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    return {
      session,
      tx,
      prisma,
      service: new AuthService(
        prisma as unknown as PrismaService,
        new JwtService({ secret: 'refresh-test-secret' }),
      ),
    };
  }

  it('returns a rotated secret and a JWT bound to the family', async () => {
    const { service, tx } = fixture();
    const result = await service.refresh({ refreshToken: 'old-token' });
    expect(result.refreshToken).not.toBe('old-token');
    expect(result.sessionId).toBe(id);
    expect(new JwtService().decode(result.accessToken)).toMatchObject({
      sub: id,
      sid: id,
    });
    expect(tx.refreshSession.create).toHaveBeenCalledOnce();
  });

  it('re-checks a session revoked after the initial owner lookup', async () => {
    const { service, tx, session } = fixture();
    tx.refreshSession.findUnique.mockResolvedValue({
      ...session,
      revokedAt: new Date(),
    });
    await expect(
      service.refresh({ refreshToken: 'old-token' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(tx.refreshSession.create).not.toHaveBeenCalled();
  });

  it('returns a recoverable 409 for the losing concurrent rotation', async () => {
    const { service, tx } = fixture({ revokedAt: new Date() });
    tx.refreshSession.findFirst.mockResolvedValue({ id: 'new-session' });
    await expect(
      service.refresh({ refreshToken: 'old-token' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(tx.refreshSession.create).not.toHaveBeenCalled();
  });

  it('revokes the family on replay outside the concurrency window', async () => {
    const { service, tx } = fixture({
      revokedAt: new Date(Date.now() - 10_000),
    });
    await expect(
      service.refresh({ refreshToken: 'old-token' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { ...sessionFamilyWhere(id), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('uses a legacy session ID as its family without a backfill', async () => {
    const { service, tx } = fixture({ familyId: null });
    const result = await service.refresh({ refreshToken: 'legacy-token' });
    expect(result.sessionId).toBe(id);
    expect(tx.refreshSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ familyId: id }),
    });
  });
});
