import { ConflictException } from '@nestjs/common';
import type { OrganizationType, Prisma } from '../../generated/prisma/client.js';
import { payingParticipant } from './registration-profile.dto.js';

/** Called only within the approval/settlement journal transaction. Grants the
 * capabilities an administrator approved one by one; enrollments created before
 * per-capability review keep their registered activities. Only paying
 * participants (producers/cooperatives and supply-chain enterprises) may own
 * supply chains, so only they receive CREATE_CHAIN. */
export async function grantEnterpriseBusiness(
  tx: Prisma.TransactionClient,
  row: { organizationId: string; ownerId: string },
) {
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: row.organizationId },
    include: { profile: true, capabilityRequests: true },
  });
  const reviewed = org.capabilityRequests.length > 0;
  const codes = reviewed
    ? org.capabilityRequests
        .filter((r) => r.status === 'APPROVED')
        .map((r) => r.code)
    : ((org.profile?.activities ?? [org.type]) as OrganizationType[]);
  if (!codes.length)
    throw new ConflictException('Chưa có năng lực nào được phê duyệt');
  for (const code of codes)
    if (
      !(await tx.organizationCapability.findFirst({
        where: { organizationId: org.id, code, revokedAt: null },
      }))
    )
      await tx.organizationCapability.create({
        data: { organizationId: org.id, code },
      });
  const roles =
    !reviewed || payingParticipant(org.participationModel, codes)
      ? (['ORG_ADMIN', 'CREATE_CHAIN'] as const)
      : (['ORG_ADMIN'] as const);
  for (const role of roles)
    if (
      !(await tx.scopedRoleGrant.findFirst({
        where: {
          userId: row.ownerId,
          organizationId: org.id,
          scope: 'ORGANIZATION',
          role,
          revokedAt: null,
        },
      }))
    )
      await tx.scopedRoleGrant.create({
        data: {
          userId: row.ownerId,
          organizationId: org.id,
          scope: 'ORGANIZATION',
          role,
        },
      });
}
