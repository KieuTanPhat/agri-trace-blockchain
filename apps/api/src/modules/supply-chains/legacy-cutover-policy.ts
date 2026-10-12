import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';

/** Root scope is unresolved if any historical producer/transport/retail party
 * has cut over. A partner's revoke/suspend must not restore global-role access. */
export function uncutoverLegacyCycleWhere(
  actor?: CommandActor,
): Prisma.ProductionCycleWhereInput {
  if (actor?.organizationScopeActivated)
    return { id: '00000000-0000-0000-0000-000000000000' };
  return {
    chainId: null,
    organization: { businessScope: { is: null } },
    harvestEvents: {
      none: {
        lot: {
          is: {
            shipment: {
              is: {
                OR: [
                  { transporter: { businessScope: { isNot: null } } },
                  { retailer: { businessScope: { isNot: null } } },
                ],
              },
            },
          },
        },
      },
    },
  };
}

export async function legacyCycleHasCutover(
  db: Prisma.TransactionClient,
  cycleId: string,
  actorOrgId?: string | null,
) {
  if (
    actorOrgId &&
    (await db.organizationBusinessScope.findUnique({
      where: { organizationId: actorOrgId },
    }))
  )
    return true;
  return !(await db.productionCycle.findFirst({
    where: { AND: [{ id: cycleId }, uncutoverLegacyCycleWhere()] },
    select: { id: true },
  }));
}
