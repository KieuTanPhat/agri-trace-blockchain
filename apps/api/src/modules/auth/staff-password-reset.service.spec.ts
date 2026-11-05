import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  StaffPasswordResetService,
  staffResetCodeDigest,
  staffResetEligible,
} from './staff-password-reset.service.js';
const mocked = vi.hoisted(() => ({
  compare: vi.fn(),
  hash: vi.fn(),
  appendPlatformAudit: vi.fn(),
  lockPlatformAudit: vi.fn(),
}));
vi.mock('bcrypt', () => ({ compare: mocked.compare, hash: mocked.hash }));
vi.mock('../platform-governance/platform-audit.js', () => ({
  appendPlatformAudit: mocked.appendPlatformAudit,
  lockPlatformAudit: mocked.lockPlatformAudit,
}));
const secret = 'staff-reset-unit-fixture-secret-32chars';
const input = {
  requestId: '019aa900-0000-4000-8000-000000000001',
  email: 'staff@example.test',
  code: '123456',
  newPassword: 'New-password-for-test-2026',
};
function fixture() {
  const user = {
    id: 'user-a',
    email: input.email,
    organizationId: 'org-a',
    passwordHash: 'old-hash',
    accountStatus: 'ACTIVE',
    role: { code: 'ENTERPRISE_STAFF' },
    organization: { status: 'ACTIVE' },
  };
  const row = {
    id: input.requestId,
    userId: user.id,
    email: user.email,
    passwordDigest: createHash('sha256')
      .update(user.passwordHash)
      .digest('hex'),
    codeDigest: '',
    attempts: 0,
    consumedAt: null as Date | null,
    supersededAt: null as Date | null,
    expiresAt: new Date(Date.now() + 600000),
    createdAt: new Date(),
  };
  row.codeDigest = staffResetCodeDigest(secret, row, input.code);
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    user: {
      findFirst: vi.fn().mockResolvedValue(user),
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn(),
    },
    refreshSession: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    staffPasswordReset: {
      findUnique: vi.fn().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(({ data }) => ({ ...row, ...data })),
      update: vi.fn().mockImplementation(({ data }) => {
        if (data.consumedAt) row.consumedAt = data.consumedAt;
        return { ...row, ...data };
      }),
      updateMany: vi.fn(),
    },
    enterpriseMail: { create: vi.fn() },
  };
  const db = {
    $transaction: async (work: (t: typeof tx) => unknown) => work(tx),
  };
  return {
    tx,
    user,
    row,
    service: new StaffPasswordResetService(
      db as unknown as PrismaService,
      new ConfigService({ JWT_SECRET: secret }),
    ),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.hash.mockResolvedValue('new-hash');
  mocked.compare.mockResolvedValue(false);
});
describe('staff-only password recovery', () => {
  it.each(['SYSTEM_ADMIN', 'AUDITOR', 'CONSUMER', 'ENTERPRISE_ADMIN'])(
    'rejects %s eligibility',
    (role) => {
      expect(
        staffResetEligible({
          role: { code: role },
          organizationId: 'org-a',
          accountStatus: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        }),
      ).toBe(false);
    },
  );
  it('binds the OTP to the request, staff identity, email and password snapshot', () => {
    const { row } = fixture();
    const digest = staffResetCodeDigest(secret, row, '123456');
    for (const changed of [
      { ...row, id: 'other' },
      { ...row, userId: 'other' },
      { ...row, email: 'other@example.test' },
      { ...row, passwordDigest: 'other' },
    ])
      expect(staffResetCodeDigest(secret, changed, '123456')).not.toBe(digest);
  });
  it('returns the same public reply for unknown, consumer and staff email without disclosing identity', async () => {
    const unknown = fixture();
    unknown.tx.staffPasswordReset.findUnique.mockResolvedValue(null as never);
    unknown.tx.user.findFirst.mockResolvedValue(null as never);
    const consumer = fixture();
    consumer.tx.staffPasswordReset.findUnique.mockResolvedValue(null as never);
    consumer.user.role.code = 'CONSUMER';
    const staff = fixture();
    staff.tx.staffPasswordReset.findUnique.mockResolvedValue(null as never);
    expect(await unknown.service.request(input)).toEqual(
      await consumer.service.request(input),
    );
    expect(await staff.service.request(input)).toEqual(
      await unknown.service.request(input),
    );
    expect(unknown.tx.enterpriseMail.create).not.toHaveBeenCalled();
    expect(consumer.tx.enterpriseMail.create).not.toHaveBeenCalled();
    expect(staff.tx.enterpriseMail.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'STAFF_PASSWORD_RESET',
        staffResetId: input.requestId,
        otpCiphertext: expect.any(String),
      }),
    });
    expect(staff.tx.user.update).not.toHaveBeenCalled();
  });
  it('replaying the request ID does not send another message', async () => {
    const { service, tx } = fixture();
    await service.request(input);
    expect(tx.enterpriseMail.create).not.toHaveBeenCalled();
  });
  it('caps per-address resend and daily volume without returning an account-specific error', async () => {
    const recent = fixture();
    recent.tx.staffPasswordReset.findUnique.mockResolvedValue(null as never);
    recent.tx.staffPasswordReset.findFirst.mockResolvedValue(
      recent.row as never,
    );
    const daily = fixture();
    daily.tx.staffPasswordReset.findUnique.mockResolvedValue(null as never);
    daily.tx.staffPasswordReset.count.mockResolvedValue(10);
    expect(await recent.service.request(input)).toEqual(
      await daily.service.request(input),
    );
    expect(recent.tx.enterpriseMail.create).not.toHaveBeenCalled();
    expect(daily.tx.enterpriseMail.create).not.toHaveBeenCalled();
  });
  it('records a wrong-code attempt without changing the password', async () => {
    const { service, tx } = fixture();
    await expect(service.verify({ ...input, code: '654321' })).rejects.toThrow(
      'Mã không đúng',
    );
    expect(tx.staffPasswordReset.update).toHaveBeenCalledWith({
      where: { id: input.requestId },
      data: { attempts: { increment: 1 } },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    'expired',
    'used',
    'superseded',
    'locked',
    'password-changed',
    'disabled-org',
    'attempt-limit',
  ])('refuses %s proof', async (state) => {
    const { service, user, row, tx } = fixture();
    if (state === 'expired') row.expiresAt = new Date(0);
    if (state === 'used') row.consumedAt = new Date();
    if (state === 'superseded') row.supersededAt = new Date();
    if (state === 'locked') user.accountStatus = 'LOCKED';
    if (state === 'password-changed') user.passwordHash = 'changed';
    if (state === 'disabled-org') user.organization.status = 'INACTIVE';
    if (state === 'attempt-limit') row.attempts = 5;
    await expect(service.verify(input)).rejects.toThrow('Mã không đúng');
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it('consumes one proof, revokes all sessions and appends a secret-free audit only after verification', async () => {
    const { service, tx } = fixture();
    const proof = await service.verify(input);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(
      await service.confirm({ ...input, resetToken: proof.resetToken }),
    ).toEqual({ changed: true });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      data: expect.objectContaining({
        passwordHash: 'new-hash',
        mustChangePassword: false,
      }),
    });
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-a', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocked.appendPlatformAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'STAFF_PASSWORD_RESET',
        details: { sessionsRevoked: 2 },
      }),
    );
    expect(JSON.stringify(mocked.appendPlatformAudit.mock.calls)).not.toContain(
      input.code,
    );
    expect(JSON.stringify(mocked.appendPlatformAudit.mock.calls)).not.toContain(
      input.newPassword,
    );
    await expect(
      service.confirm({ ...input, resetToken: proof.resetToken }),
    ).rejects.toThrow('Mã không đúng');
    expect(tx.user.update).toHaveBeenCalledOnce();
  });
  it('rejects an OTP passed as a reset proof, without changing credentials', async () => {
    const { service, tx } = fixture();
    await expect(
      service.confirm({ ...input, resetToken: input.code }),
    ).rejects.toThrow('Mã không đúng');
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it('does not issue proof until the OTP is correct; verification alone changes no credentials', async () => {
    const { service, tx } = fixture();
    const proof = await service.verify(input);
    expect(proof.resetToken).toMatch(/^\d{13}\.[a-f0-9]{64}$/);
    expect(proof.expiresInSeconds).toBeGreaterThan(0);
    expect(proof.expiresInSeconds).toBeLessThanOrEqual(300);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(mocked.appendPlatformAudit).not.toHaveBeenCalled();
  });
  it.each([
    'tampered',
    'expired',
    'other-request',
    'superseded',
    'password-changed',
    'disabled-org',
  ])('refuses %s verification grants', async (state) => {
    const { service, row, user, tx } = fixture();
    const proof = await service.verify(input);
    let resetToken = proof.resetToken;
    if (state === 'tampered')
      resetToken =
        resetToken.slice(0, -1) + (resetToken.endsWith('a') ? 'b' : 'a');
    if (state === 'expired')
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000);
    if (state === 'other-request') row.id = 'other';
    if (state === 'superseded') row.supersededAt = new Date();
    if (state === 'password-changed') user.passwordHash = 'changed-hash';
    if (state === 'disabled-org') user.organization.status = 'INACTIVE';
    try {
      await expect(service.confirm({ ...input, resetToken })).rejects.toThrow(
        'Mã không đúng',
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
