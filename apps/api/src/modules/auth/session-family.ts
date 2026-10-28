import type { Prisma } from '../../generated/prisma/client.js';

export function sessionFamilyWhere(familyId: string) {
  return { familyId };
}

export async function lockSessionOwner(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string | null,
  mode: 'read' | 'write' = 'write',
): Promise<void> {
  // Organization updates lock this row before revoking members' sessions.
  // Authentication reads its status; a shared lock still excludes disable,
  // without serializing all users or waiting behind business readers.
  // Always take it before the user row to keep a consistent lock order.
  if (organizationId) {
    await tx.$queryRaw`SELECT organization_id FROM organization
      WHERE organization_id = ${organizationId}::uuid FOR SHARE`;
  }
  // Account status updates acquire the same lock before session revocation.
  // Login creates a new independent family and only reads account authority.
  // Rotation/logout keep an exclusive user lock to serialize family changes.
  if (mode === 'read') {
    await tx.$queryRaw`SELECT user_id FROM app_user
      WHERE user_id = ${userId}::uuid FOR SHARE`;
  } else {
    await tx.$queryRaw`SELECT user_id FROM app_user
      WHERE user_id = ${userId}::uuid FOR UPDATE`;
  }
}
