import type { Prisma } from '../../generated/prisma/client.js';
import { assertEntitlement } from '../billing/billing-core.js';

type Tx = Prisma.TransactionClient;

const inChain = (chainId: string): Prisma.LotWhereInput => ({
  OR: [{ harvest: { cycle: { chainId } } }, { processingRun: { chainId } }],
});

/** True while the organization still holds goods of the chain or takes part
 * in an open handover there (ADR-005). Closing waits for this to clear. */
export async function partnerHasWork(
  tx: Tx,
  chainId: string,
  organizationId: string,
) {
  const holdings = await tx.lotHolding.findMany({
    where: { organizationId, quantity: { gt: 0 } },
    select: { lotId: true },
  });
  const [held, transfers] = await Promise.all([
    holdings.length
      ? tx.lot.count({ where: { id: { in: holdings.map((h) => h.lotId) }, ...inChain(chainId) } })
      : Promise.resolve(0),
    tx.distributionTransfer.count({
      where: {
        chainId,
        status: { in: ['PROPOSED', 'READY', 'IN_TRANSIT'] },
        OR: [
          { senderId: organizationId },
          { receiverId: organizationId },
          { carrierId: organizationId },
        ],
      },
    }),
  ]);
  return held > 0 || transfers > 0;
}

/** A partner organization becoming ACTIVE in an owner's chain takes one
 * partner slot of the owner's plan, unless it already holds one through
 * another chain of the same owner. The free farm ledger has no slots. */
export async function assertPartnerSlot(
  tx: Tx,
  chainId: string,
  organizationId: string,
) {
  const chain = await tx.supplyChain.findUniqueOrThrow({
    where: { id: chainId },
    select: { personal: true, ownerOrganizationId: true },
  });
  if (chain.personal || chain.ownerOrganizationId === organizationId) return;
  const counted = await tx.chainMembership.findFirst({
    where: {
      organizationId,
      status: 'ACTIVE',
      chain: { ownerOrganizationId: chain.ownerOrganizationId, personal: false },
    },
  });
  if (!counted) await assertEntitlement(tx, chain.ownerOrganizationId, 'partners');
}
