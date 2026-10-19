import type { Prisma } from '../../generated/prisma/client.js';
/** Called only within the approval/settlement journal transaction. */
export async function grantEnterpriseBusiness(
  tx: Prisma.TransactionClient,
  row: { organizationId: string; ownerId: string },
) {
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: row.organizationId },
    include: { profile: true },
  });
  for (const code of org.profile?.activities ?? [org.type])
    if(!await tx.organizationCapability.findFirst({where:{organizationId:org.id,code:code as typeof org.type,revokedAt:null}})) await tx.organizationCapability.create({
      data: { organizationId: org.id, code: code as typeof org.type },
    });
  for (const role of ['ORG_ADMIN', 'CREATE_CHAIN'] as const)
    if(!await tx.scopedRoleGrant.findFirst({where:{userId:row.ownerId,organizationId:org.id,scope:'ORGANIZATION',role,revokedAt:null}})) await tx.scopedRoleGrant.create({
      data: {
        userId: row.ownerId,
        organizationId: org.id,
        scope: 'ORGANIZATION',
        role,
      },
    });
}
