import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { lockLegacySnapshot } from './legacy-scope.commands.js';
import { assertLegacyScopeProvenance } from './legacy-scope-pins.js';

/** Caller owns the current owner/manager command lock. The history fence also
 * serializes unscoped writers; DB guards see the committed cutover marker after
 * waiting. No authority or historical route is inferred from membership. */
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
  await lockLegacySnapshot(db);
  const [unresolved] = await db.$queryRaw<Array<{ blocked: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM production_cycle c WHERE c.chain_id IS NULL AND fn_hybrid_legacy_root_active(c.cycle_id)
      AND EXISTS(SELECT 1 FROM chain_membership n WHERE n.chain_id=${chainId}::uuid AND n.status='ACTIVE'
        AND (n.organization_id=c.farm_org_id OR EXISTS(SELECT 1 FROM harvest_event h JOIN lot l USING(harvest_id) JOIN shipment s USING(lot_id)
          WHERE h.cycle_id=c.cycle_id AND n.organization_id IN(s.transporter_org_id,s.retailer_org_id))))) AS blocked`;
  if (unresolved.blocked)
    throw new ConflictException(
      'Active unresolved legacy root blocks activation',
    );
  const mappings = await db.legacyScopeMapping.findMany({
    where: { chainId },
    select: { cycleId: true },
    take: 10001,
  });
  if (mappings.length > 10000)
    throw new ConflictException('Activation cần rehearsal phân trang');
  for (const mapping of mappings)
    await assertLegacyScopeProvenance(db, mapping.cycleId);
}
