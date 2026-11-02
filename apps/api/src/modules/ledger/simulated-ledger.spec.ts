import type { Prisma } from '../../generated/prisma/client.js';
import { confirmSimulatedPermissions } from './simulated-ledger.js';
import { vi } from 'vitest';

describe('Scoped simulated permission confirmation', () => {
  it.each([{ bindingDigests: undefined }, { bindingDigests: [] }, { bindingDigests: ['a'.repeat(64)] }])('keeps an explicitly empty or selected binding scope ($bindingDigests)', async ({ bindingDigests }) => {
    const tx = {
      fabricNetworkBinding: { count: vi.fn().mockResolvedValue(0) },
      ledgerControlJob: { findMany: vi.fn().mockResolvedValue([]) },
    };
    expect(await confirmSimulatedPermissions(tx as unknown as Prisma.TransactionClient, { bindingDigests })).toBe(0);
    const where = tx.ledgerControlJob.findMany.mock.calls[0][0].where;
    expect(where.binding).toEqual({ network: 'simulated-ledger' });
    if (bindingDigests) expect(where.bindingDigest).toEqual({ in: bindingDigests });
    else expect(where.bindingDigest).toBeUndefined();
  });
});
