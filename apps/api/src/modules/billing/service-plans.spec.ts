import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { publishedCatalog, publishPlanVersionTx } from './billing-core.js';
const audit = vi.hoisted(() => ({
  appendPlatformAudit: vi.fn(),
  lockPlatformAudit: vi.fn(),
  isAuditedCommand: () => true,
}));
vi.mock('../platform-governance/platform-audit.js', () => audit);
const actor = { sub: 'admin', role: 'SYSTEM_ADMIN', organizationId: null };
function fixture(status = 'ACTIVE') {
  const plan = { code: 'UI_TEST_1K', name: 'Gói thử giao diện', status };
  const tx = {
    $executeRaw: vi.fn(),
    servicePlan: {
      findUnique: vi.fn().mockResolvedValue(plan),
      create: vi.fn().mockResolvedValue(plan),
      update: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...plan, ...data }),
        ),
    },
    servicePlanVersion: {
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            id: 'version-1',
            status: 'DRAFT',
            publishedAt: null,
            createdAt: new Date(),
          }),
        ),
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: 'version-1',
          planCode: plan.code,
          status: 'DRAFT',
        }),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    subscription: { update: vi.fn() },
    invoice: { update: vi.fn() },
  };
  const db = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
  };
  return { tx, service: new BillingService(db as unknown as PrismaService) };
}
const input = {
  code: 'UI_TEST_1K',
  name: 'Gói thử giao diện',
  description: 'Dùng kiểm giao diện',
  setupFee: 0,
  annualFee: 1000,
  termMonths: 12,
  limits: { chains: 1, partners: 5, members: 10, products: 5 },
  note: 'Thêm gói kiểm tra giao diện',
};
beforeEach(() => vi.clearAllMocks());
describe('service plan administration', () => {
  it('creates a plan and draft snapshot together, without publishing or charging', async () => {
    const { tx, service } = fixture();
    tx.servicePlan.findUnique.mockResolvedValue(null as never);
    const result = await service.createPlan(actor, input);
    expect(result.record.version.status).toBe('DRAFT');
    expect(tx.servicePlanVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 1,
        setupFee: 0n,
        annualFee: 1000n,
        createdBy: 'admin',
      }),
    });
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(audit.appendPlatformAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'SERVICE_PLAN_CREATED',
        subjectId: 'UI_TEST_1K',
      }),
    );
  });
  it('rejects duplicate codes rather than overwriting existing versions', async () => {
    const { tx, service } = fixture();
    await expect(service.createPlan(actor, input)).rejects.toThrow(
      'đã tồn tại',
    );
    expect(tx.servicePlan.create).not.toHaveBeenCalled();
    expect(tx.servicePlanVersion.create).not.toHaveBeenCalled();
  });
  it.each([
    ['ACTIVE', 'RETIRED'],
    ['RETIRED', 'ACTIVE'],
  ] as const)(
    'changes %s to %s without changing paid services or historical snapshots',
    async (previous, status) => {
      const { tx, service } = fixture(previous);
      await service.setPlanStatus(actor, input.code, {
        expectedStatus: previous,
        status,
        reason: 'Thay đổi cung cấp để kiểm thử',
      });
      expect(tx.servicePlan.update).toHaveBeenCalledWith({
        where: { code: input.code },
        data: { status },
      });
      expect(tx.servicePlanVersion.update).not.toHaveBeenCalled();
      expect(tx.subscription.update).not.toHaveBeenCalled();
      expect(tx.invoice.update).not.toHaveBeenCalled();
      expect(audit.appendPlatformAudit).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action:
            status === 'ACTIVE'
              ? 'SERVICE_PLAN_RESUMED'
              : 'SERVICE_PLAN_RETIRED',
        }),
      );
    },
  );
  it('rejects stale status decisions and does not append a success audit', async () => {
    const { tx, service } = fixture('RETIRED');
    await expect(
      service.setPlanStatus(actor, input.code, {
        expectedStatus: 'ACTIVE',
        status: 'RETIRED',
        reason: 'Thay đổi cung cấp để kiểm thử',
      }),
    ).rejects.toThrow('đã thay đổi');
    expect(tx.servicePlan.update).not.toHaveBeenCalled();
    expect(audit.appendPlatformAudit).not.toHaveBeenCalled();
  });
  it('refuses publishing a draft while the plan is stopped', async () => {
    const { tx } = fixture('RETIRED');
    await expect(
      publishPlanVersionTx(
        tx as never,
        actor,
        'version-1',
        'Kiểm tra công bố phiên bản',
      ),
    ).rejects.toThrow('Mở lại');
    expect(tx.servicePlanVersion.update).not.toHaveBeenCalled();
  });
  it('only queries active plans in the enterprise catalog', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await publishedCatalog({ servicePlan: { findMany } } as never);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE' },
        include: { versions: { where: { status: 'PUBLISHED' } } },
      }),
    );
  });
});
