import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import { assertChainCreatesWork, assertEntitlement, entitlementFor } from './billing-core.js';

afterEach(() => vi.unstubAllEnvs());
const fixture = (code: 'FARM' | 'RETAILER', subscription: unknown = null) => {
  const source = {
    organization: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          participationStatus: code === 'FARM' ? 'CHAIN_OWNER' : 'MEMBER',
          _count: { capabilityRequests: 1 },
        }),
    },
    subscription: { findFirst: vi.fn().mockResolvedValue(subscription) },
    organizationCapability: { findMany: vi.fn().mockResolvedValue([{ code }]) },
    platformSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { count: vi.fn().mockResolvedValue(30) },
    supplyChain: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue({ personal: true, ownerOrganizationId: 'org' }) },
    chainMembership: { findMany: vi.fn().mockResolvedValue([{ organizationId: 'p1' }]) },
    productionCycle: { count: vi.fn().mockResolvedValue(10) },
    lot: { count: vi.fn().mockResolvedValue(3) },
    user: { count: vi.fn().mockResolvedValue(1) },
  };
  return { tx: source as unknown as Prisma.TransactionClient, source };
};
describe('Entitlements while collection is deferred', () => {
  it('does not block approved producer creation for a missing paid plan', async () => {
    vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', 'false');
    const { tx, source } = fixture('FARM');
    await expect(
      assertEntitlement(tx, 'org', 'products'),
    ).resolves.toBeUndefined();
    await expect(
      assertEntitlement(tx, 'org', 'members'),
    ).resolves.toBeUndefined();
    await expect(
      assertEntitlement(tx, 'org', 'chains'),
    ).resolves.toBeUndefined();
    expect(source.product.count).not.toHaveBeenCalled();
  });
  it('still refuses a missing plan when billing is explicitly enabled', async () => {
    vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', 'true');
    const { tx } = fixture('FARM');
    await expect(assertEntitlement(tx, 'org', 'products')).rejects.toThrow(
      'chưa có gói',
    );
  });
  it('keeps basic participant limits when collection is deferred', async () => {
    vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', 'false');
    const { tx } = fixture('RETAILER');
    expect(await entitlementFor(tx, 'org')).toMatchObject({
      status: 'PARTICIPANT',
      applies: true,
    });
    await expect(assertEntitlement(tx, 'org', 'products')).rejects.toThrow(
      'Vượt hạn mức',
    );
  });
  it('gives members no partner slot and counts distinct partners (ADR-005)', async () => {
    vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', 'false');
    const { tx } = fixture('RETAILER');
    await expect(assertEntitlement(tx, 'org', 'partners')).rejects.toThrow('đối tác trong chuỗi');
  });
  it('limits the free farm ledger per year without touching plans', async () => {
    const { tx } = fixture('FARM');
    await expect(assertChainCreatesWork(tx, 'ledger', 'cycles')).rejects.toThrow('Sổ ghi nông trại');
    await expect(assertChainCreatesWork(tx, 'ledger', 'lots')).resolves.toBeUndefined();
    await expect(assertChainCreatesWork(tx, 'ledger', 'runs')).resolves.toBeUndefined();
  });
  it('preserves an existing unpaid subscription without claiming it is paid', async () => {
    vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', 'false');
    const subscription = { id: 'unpaid', status: 'PENDING_PAYMENT' };
    const { tx } = fixture('FARM', subscription);
    expect(await entitlementFor(tx, 'org')).toMatchObject({
      applies: false,
      status: 'UNRESTRICTED',
      subscription,
    });
    expect(subscription.status).toBe('PENDING_PAYMENT');
  });
});
