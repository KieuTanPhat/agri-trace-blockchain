import type {
  Prisma,
  PrismaClient,
  ScopedRole,
} from '../../src/generated/prisma/client.js';
import {
  confirmSimulatedPermissions,
  simulateChainBinding,
} from '../../src/modules/ledger/simulated-ledger.js';

type Grant = { userId: string; organizationId: string; role: ScopedRole };
type ChainInput = {
  name?: string;
  ownerOrganizationId: string;
  memberOrganizationIds: string[];
  grants: Grant[];
  /** Bind the chain to a simulated ledger (default). Hybrid suites that
   * register their own binding pass false. */
  simulatedLedger?: boolean;
};

/** Direct test provisioning of an ACTIVE chain. The supply-chain API flow has
 * its own E2E coverage; business workflow tests only need a valid scope. */
export function provisionChain(prisma: PrismaClient, input: ChainInput) {
  return prisma.$transaction((tx) => provisionChainIn(tx, input));
}

/** Same as provisionChain inside a caller-owned transaction. */
export async function provisionChainIn(
  tx: Prisma.TransactionClient,
  input: ChainInput,
) {
  const chain = await tx.supplyChain.create({
    data: {
      name: input.name ?? 'Test chain',
      ownerOrganizationId: input.ownerOrganizationId,
    },
  });
  const members = new Set([
    input.ownerOrganizationId,
    ...input.memberOrganizationIds,
  ]);
  for (const organizationId of members)
    await tx.chainMembership.create({
      data: { chainId: chain.id, organizationId, status: 'ACTIVE' },
    });
  await tx.chainBusinessProfile.create({ data: { chainId: chain.id } });
  await tx.chainBusinessProfile.update({
    where: { chainId: chain.id },
    data: { state: 'ACTIVE', version: { increment: 1 } },
  });
  for (const grant of input.grants) {
    const organizationLevel = ['ORG_ADMIN', 'CREATE_CHAIN'].includes(
      grant.role,
    );
    if (
      organizationLevel &&
      (await tx.scopedRoleGrant.findFirst({
        where: { ...grant, chainId: null, revokedAt: null },
      }))
    )
      continue;
    await tx.scopedRoleGrant.create({
      data: {
        ...grant,
        scope: organizationLevel ? 'ORGANIZATION' : 'CHAIN',
        chainId: organizationLevel ? null : chain.id,
      },
    });
  }
  if (input.simulatedLedger !== false) {
    await simulateChainBinding(tx, chain.id, { guard: false });
    await confirmSimulatedPermissions(tx, { guard: false });
  }
  return chain.id;
}

/** Bind a chain created through the API and confirm pending grants, as the
 * simulated ledger does locally. Synthetic: not Fabric evidence. */
export function simulateChainLedger(prisma: PrismaClient, chainId: string) {
  return prisma.$transaction(async (tx) => {
    await simulateChainBinding(tx, chainId, { guard: false });
    await confirmSimulatedPermissions(tx, { guard: false });
  });
}

/** Bind chains created by SQL fixtures, and their existing cycles, to a
 * simulated ledger. Synthetic: not Fabric evidence. */
export function simulateFixtureLedger(prisma: PrismaClient, chainIds: string[]) {
  return prisma.$transaction(async (tx) => {
    for (const chainId of chainIds) {
      const bindingDigest = await simulateChainBinding(tx, chainId, {
        guard: false,
      });
      const cycles = await tx.productionCycle.findMany({
        where: { chainId, ledgerContexts: { none: {} } },
        select: { id: true },
      });
      for (const cycle of cycles)
        await tx.cycleLedgerContext.create({
          data: { cycleId: cycle.id, chainId, bindingDigest },
        });
    }
    await confirmSimulatedPermissions(tx, { guard: false });
  });
}

/** Attach a cycle created directly in SQL to its chain's active binding, as
 * cycle creation does. */
export async function bindCycle(
  tx: Prisma.TransactionClient,
  cycleId: string,
  chainId: string,
) {
  const { activeBindingDigest } = await tx.chainLedgerProfile.findUniqueOrThrow(
    { where: { chainId } },
  );
  await tx.cycleLedgerContext.create({
    data: { cycleId, chainId, bindingDigest: activeBindingDigest! },
  });
}

/** Confirm grants requested after provisioning (new members, new roles). */
export function confirmLedgerGrants(prisma: PrismaClient) {
  return prisma.$transaction((tx) =>
    confirmSimulatedPermissions(tx, { guard: false }),
  );
}
