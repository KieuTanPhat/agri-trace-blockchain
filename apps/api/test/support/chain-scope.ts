import type {
  Prisma,
  PrismaClient,
  ScopedRole,
} from '../../src/generated/prisma/client.js';

type Grant = { userId: string; organizationId: string; role: ScopedRole };
type ChainInput = {
  name?: string;
  ownerOrganizationId: string;
  memberOrganizationIds: string[];
  grants: Grant[];
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
  return chain.id;
}
