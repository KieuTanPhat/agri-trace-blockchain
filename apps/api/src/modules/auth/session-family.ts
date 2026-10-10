import type { Prisma } from '../../generated/prisma/client.js';

// Nullable family_id lets the previous API keep creating sessions after an
// application rollback. A legacy session starts its family at its own ID.
export function sessionFamilyWhere(familyId: string) {
  return { OR: [{ familyId }, { id: familyId, familyId: null }] };
}

export async function lockSessionOwner(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string | null,
): Promise<void> {
  // Organization updates lock this row before revoking members' sessions.
  // Always take it before the user row to keep a consistent lock order.
  if (organizationId) {
    await tx.$queryRaw`SELECT organization_id FROM organization
      WHERE organization_id = ${organizationId}::uuid FOR UPDATE`;
  }
  // Account status updates acquire the same lock before session revocation.
  await tx.$queryRaw`SELECT user_id FROM app_user
    WHERE user_id = ${userId}::uuid FOR UPDATE`;
}
