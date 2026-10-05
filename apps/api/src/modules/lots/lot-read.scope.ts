import type { Prisma } from '../../generated/prisma/client.js';
import type { Actor } from '../trace/trace.service.js';

/** Keep list and dashboard reads scoped to the same organizations. */
export function lotReadScope(actor: Actor): Prisma.LotWhereInput | undefined {
  if (['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)) return undefined;
  const organizationId =
    actor.organizationId ?? '00000000-0000-0000-0000-000000000000';
  return {
    OR: [
      { farmOrgId: organizationId },
      { shipment: { transporterOrgId: organizationId } },
      { shipment: { retailerOrgId: organizationId } },
    ],
  };
}
