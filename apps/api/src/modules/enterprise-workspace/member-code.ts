import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Next internal member code of an organization (NV0001, NV0002 …).
 * Codes already held by accounts or reserved by invitations are never reused.
 * Call under the organization lock so two creations cannot draw the same code.
 */
export async function nextMemberCode(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`member-code:${organizationId}`},0))`;
  const [row] = await tx.$queryRaw<{ next: number }[]>`
    SELECT COALESCE(MAX(substring(code from 3)::int), 0) + 1 AS next FROM (
      SELECT member_code AS code FROM app_user
       WHERE organization_id = ${organizationId}::uuid AND member_code IS NOT NULL
      UNION ALL
      SELECT member_code FROM enterprise_invitation
       WHERE organization_id = ${organizationId}::uuid AND member_code IS NOT NULL
    ) codes
  `;
  return 'NV' + String(row.next).padStart(4, '0');
}
