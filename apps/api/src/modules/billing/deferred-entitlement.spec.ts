import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import { assertEntitlement, entitlementFor } from './billing-core.js';

afterEach(() => vi.unstubAllEnvs());
const fixture = (code: 'FARM' | 'RETAILER', subscription: unknown = null) => {
  const source = {
    organization: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          participationModel: 'SINGLE',
          _count: { capabilityRequests: 1 },
        }),
    },
    subscription: { findFirst: vi.fn().mockResolvedValue(subscription) },
    organizationCapability: { findMany: vi.fn().mockResolvedValue([{ code }]) },
    platformSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { count: vi.fn().mockResolvedValue(30) },
    supplyChain: { count: vi.fn().mockResolvedValue(0) },
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
