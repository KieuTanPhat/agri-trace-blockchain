import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  assertActivationReady,
  assertEnterprisePaymentsEnabled,
  enterprisePaymentsEnabled,
  serviceWorkspaceStage,
} from './payment-policy.js';
import { simulationEnabled } from './service-catalog.js';

afterEach(() => vi.unstubAllEnvs());
const row = (statuses: Array<'PENDING' | 'APPROVED' | 'REJECTED'>) => ({
  organizationId: 'isolated-organization',
  organization: {
    participationModel: 'SINGLE',
    capabilityRequests: statuses.map((status) => ({
      code: 'FARM' as const,
      status,
    })),
  },
});
const database = () => {
  const findFirst = vi.fn().mockResolvedValue(null);
  return {
    tx: { subscription: { findFirst } } as unknown as Prisma.TransactionClient,
    findFirst,
  };
};

describe('Deferred enterprise payments', () => {
  it('defaults to deferred collection, including when only simulation was enabled', () => {
    vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', undefined);
    vi.stubEnv('ENTERPRISE_PAYMENT_SIMULATION_ENABLED', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    expect(enterprisePaymentsEnabled()).toBe(false);
    expect(simulationEnabled()).toBe(false);
    expect(() => assertEnterprisePaymentsEnabled()).toThrow(
      'Thanh toán đang tạm hoãn',
    );
    expect(serviceWorkspaceStage('ACTIVE')).toBe('TEMPORARY_ACCESS');
    expect(serviceWorkspaceStage('AWAITING_ACTIVATION')).toBe(
      'AWAITING_TEMPORARY_ACTIVATION',
    );
    expect(serviceWorkspaceStage('PENDING_REVIEW')).toBe('PENDING_REVIEW');
    expect(serviceWorkspaceStage('REJECTED')).toBe('REJECTED');
  });
  it('allows approved capabilities without reading or fabricating a subscription', async () => {
    vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', 'false');
    const { tx, findFirst } = database();
    await expect(
      assertActivationReady(tx, row(['APPROVED'])),
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });
  it.each([['PENDING'], ['REJECTED'], ['APPROVED', 'PENDING']] as const)(
    'keeps capability review mandatory for %j',
    async (...statuses) => {
      vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', 'false');
      const { tx, findFirst } = database();
      await expect(
        assertActivationReady(tx, row([...statuses])),
      ).rejects.toThrow();
      expect(findFirst).not.toHaveBeenCalled();
    },
  );
  it('retains the payment prerequisite only when the operator explicitly re-enables it', async () => {
    vi.stubEnv('ENTERPRISE_PAYMENTS_ENABLED', 'true');
    const { tx, findFirst } = database();
    expect(serviceWorkspaceStage('ACTIVE')).toBe('ACTIVE');
    await expect(assertActivationReady(tx, row(['APPROVED']))).rejects.toThrow(
      'thanh toán',
    );
    findFirst.mockResolvedValue({ id: 'existing-paid-subscription' });
    await expect(
      assertActivationReady(tx, row(['APPROVED'])),
    ).resolves.toBeUndefined();
  });
});
