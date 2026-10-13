import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

/** Caller owns the current owner/manager command lock. Activation only needs
 * every active member organization to still be active; no authority is
 * inferred from membership. */
export async function assertBusinessActivationReady(
  db: Prisma.TransactionClient,
  chainId: string,
) {
  await db.$queryRaw`SELECT membership_id FROM chain_membership WHERE chain_id=${chainId}::uuid ORDER BY organization_id FOR SHARE`;
  const members = await db.chainMembership.findMany({
    where: { chainId, status: 'ACTIVE' },
    orderBy: { organizationId: 'asc' },
  });
  for (const member of members) {
    await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id=${member.organizationId}::uuid FOR SHARE`;
    const org = await db.organization.findUniqueOrThrow({
      where: { id: member.organizationId },
    });
    if (org.status !== 'ACTIVE')
      throw new ConflictException('Thành viên kích hoạt không còn hoạt động');
  }
}
