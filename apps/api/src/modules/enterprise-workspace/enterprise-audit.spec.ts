import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { EnterpriseAuditService } from './enterprise-audit.service.js';
const organizationId = '11111111-1111-4111-8111-111111111111';
const employee = {
  id: '22222222-2222-4222-8222-222222222222',
  fullName: 'Nhân viên A',
  email: 'a@example.test',
};
const actor = {
  sub: '33333333-3333-4333-8333-333333333333',
  role: 'FARM_STAFF',
  organizationId,
};
function fixture() {
  const user = {
    id: actor.sub,
    organizationId,
    accountStatus: 'ACTIVE',
    enterpriseTier: 1,
    enterpriseRevision: 0,
    supervisorId: null,
    enterpriseRoles: [],
    organization: { status: 'ACTIVE', enterpriseEnrollment: null },
  };
  const tx = {
    $executeRaw: vi.fn(),
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      findMany: vi.fn().mockResolvedValue([employee]),
    },
    scopedRoleGrant: {
      findFirst: vi.fn().mockResolvedValue({ id: 'grant', revision: 1 }),
    },
    organizationCapability: {
      findMany: vi.fn().mockResolvedValue([{ code: 'FARM' }]),
    },
    commandCommit: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: '44444444-4444-4444-8444-444444444444' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    platformAudit: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: '55555555-5555-4555-8555-555555555555' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return {
    tx,
    user,
    service: new EnterpriseAuditService(
      db as unknown as PrismaService,
      new ConfigService({
        JWT_SECRET: 'enterprise-audit-unit-test-secret-32-chars',
      }),
    ),
  };
}
const command = (
  id = '44444444-4444-4444-8444-444444444444',
  time = '2026-11-05T06:00:00Z',
) => ({
  id,
  requesterId: employee.id,
  committedAt: new Date(time),
  operation: 'RECORD_CARE',
  responseBody: { password: 'MUST_NOT_LEAK' },
  actorScope: { organizationId },
});
const account = () => ({
  id: '55555555-5555-4555-8555-555555555555',
  actorUserId: employee.id,
  occurredAt: new Date('2026-11-05T05:00:00Z'),
  action: 'PASSWORD_CHANGED',
  outcome: 'SUCCESS',
  details: { token: 'MUST_NOT_LEAK' },
});
describe('Enterprise employee audit', () => {
  it('requires the actual organization owner, never employees or platform roles', async () => {
    for (const role of ['SYSTEM_ADMIN', 'AUDITOR', 'IOT_DEVICE']) {
      const { service, tx } = fixture();
      await expect(service.list({ ...actor, role }, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.commandCommit.findMany).not.toHaveBeenCalled();
    }
    const { service, tx, user } = fixture();
    user.enterpriseTier = 3;
    tx.scopedRoleGrant.findFirst.mockResolvedValue(null as never);
    await expect(
      service.list({ ...actor, role: 'ENTERPRISE_STAFF' }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.platformAudit.findMany).not.toHaveBeenCalled();
  });
  it('scopes both journals to current staff and the recorded organization, without returning payloads', async () => {
    const { service, tx } = fixture();
    tx.commandCommit.findMany.mockResolvedValue([command()] as never);
    tx.platformAudit.findMany.mockResolvedValue([account()] as never);
    const page = await service.list(actor, {});
    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId, role: { code: 'ENTERPRISE_STAFF' } },
      }),
    );
    expect(tx.commandCommit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requesterId: { in: [employee.id] },
          actorScope: { path: ['organizationId'], equals: organizationId },
        }),
      }),
    );
    expect(tx.platformAudit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId,
          actorUserId: { in: [employee.id] },
          actorRole: 'ENTERPRISE_STAFF',
        }),
      }),
    );
    expect(page.items.map((r) => r.category)).toEqual(['ACTIVITY', 'ACCOUNT']);
    expect(JSON.stringify(page)).not.toContain('MUST_NOT_LEAK');
    expect(page.items[0].employee).toEqual(employee);
  });
  it('returns an empty page for a foreign or nonexistent employee filter', async () => {
    const { service, tx } = fixture();
    tx.user.findMany.mockResolvedValue([]);
    expect(
      (
        await service.list(actor, {
          employeeId: '66666666-6666-4666-8666-666666666666',
        })
      ).items,
    ).toEqual([]);
    expect(tx.commandCommit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requesterId: { in: [] } }),
      }),
    );
  });
  it('uses per-source bookmarks so a page does not skip the other journal', async () => {
    const { service, tx } = fixture();
    tx.commandCommit.findMany.mockResolvedValue([command()] as never);
    tx.platformAudit.findMany.mockResolvedValue([account()] as never);
    const first = await service.list(actor, { limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    await service.list(actor, { limit: 1, cursor: first.nextCursor! });
    expect(tx.commandCommit.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: command().id }, skip: 1 }),
    );
    expect(tx.platformAudit.findMany.mock.calls[1][0]).not.toHaveProperty(
      'cursor',
    );
    for (const changes of [
      { ...actor, organizationId: '77777777-7777-4777-8777-777777777777' },
      { ...actor, sub: '88888888-8888-4888-8888-888888888888' },
    ])
      await expect(
        service.list(changes, { cursor: first.nextCursor! }),
      ).rejects.toThrow();
    await expect(
      service.list(actor, { cursor: first.nextCursor!, q: 'other' }),
    ).rejects.toThrow('Trang lịch sử');
    await expect(
      service.list(actor, { cursor: first.nextCursor!.slice(0, -1) + 'x' }),
    ).rejects.toThrow('Trang lịch sử');
  });
  it('rejects bookmarks no longer in the scoped query', async () => {
    const { service, tx } = fixture();
    tx.commandCommit.findMany.mockResolvedValue([
      command(),
      command('99999999-9999-4999-8999-999999999999', '2026-11-04T00:00:00Z'),
    ] as never);
    const first = await service.list(actor, { limit: 1 });
    tx.commandCommit.findFirst.mockResolvedValue(null as never);
    await expect(
      service.list(actor, { limit: 1, cursor: first.nextCursor! }),
    ).rejects.toThrow('Trang lịch sử');
  });
  it('filters employee/date/action/result and rejects reversed dates', async () => {
    const { service, tx } = fixture();
    await service.list(actor, {
      q: 'Nhân viên',
      action: 'PASSWORD_CHANGED',
      outcome: 'FAILED',
      from: '2026-11-01T00:00:00Z',
      to: '2026-11-05T00:00:00Z',
    });
    expect(tx.commandCommit.findMany).not.toHaveBeenCalled();
    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { fullName: { contains: 'Nhân viên', mode: 'insensitive' } },
            { email: { contains: 'Nhân viên', mode: 'insensitive' } },
          ],
        }),
      }),
    );
    expect(tx.platformAudit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outcome: 'FAILED',
          action: expect.objectContaining({ equals: 'PASSWORD_CHANGED' }),
          occurredAt: {
            gte: new Date('2026-11-01T00:00:00Z'),
            lte: new Date('2026-11-05T00:00:00Z'),
          },
        }),
      }),
    );
    await expect(
      service.list(actor, { from: '2026-11-05', to: '2026-11-01' }),
    ).rejects.toThrow('Khoảng thời gian');
  });
});
