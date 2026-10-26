import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { requestLedgerGrant } from '../ledger/ledger-permissions.js';
import { SUPPLY_STAGES } from './dto.js';

type Stage = (typeof SUPPLY_STAGES)[number];
/** Chain business role the owner holds for each approved stage. */
const STAGE_ROLE: Record<Stage, 'FARM_STAFF' | 'PROCESSOR' | 'TRANSPORTER' | 'DISTRIBUTOR' | 'RETAILER'> = {
  FARM: 'FARM_STAFF',
  PROCESSOR: 'PROCESSOR',
  TRANSPORTER: 'TRANSPORTER',
  DISTRIBUTOR: 'DISTRIBUTOR',
  RETAILER: 'RETAILER',
};

/** Gives a producing enterprise its personal chain (idempotent), inside the
 * caller's transaction: an ACTIVE business profile and membership, the owner as
 * chain manager plus the business roles of its approved stages. The ledger
 * binding is registered outside the API (operator or local simulator); until
 * it is ACTIVE the chain accepts no production command, and binding activation
 * then queues every grant written here for ledger confirmation. */
export async function ensurePersonalChain(
  tx: Prisma.TransactionClient,
  row: { organizationId: string; ownerId: string },
) {
  await tx.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${row.organizationId}::uuid FOR UPDATE`;
  const existing = await tx.supplyChain.findFirst({
    where: { ownerOrganizationId: row.organizationId, personal: true },
  });
  if (existing) return { chain: existing, created: false };
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: row.organizationId },
    include: { capabilities: { where: { revokedAt: null } } },
  });
  const stages = SUPPLY_STAGES.filter((stage) =>
    org.capabilities.some((c) => c.code === stage),
  );
  const chain = await tx.supplyChain.create({
    data: {
      name: `Chuỗi riêng · ${org.name}`.slice(0, 255),
      code: `CH-${randomUUID().slice(0, 12).toUpperCase()}`,
      chainType: 'CROP',
      personal: true,
      supplyModel: {
        stages: stages.map((stage) => ({
          stage,
          organizationIds: [org.id],
        })),
      },
      ownerOrganizationId: org.id,
    },
  });
  await tx.chainMembership.create({
    data: { chainId: chain.id, organizationId: org.id, status: 'ACTIVE' },
  });
  // A profile always starts PREPARING (trg_hybrid_profile_state); the owner is
  // the only member, so it is ready to activate at once.
  await tx.chainBusinessProfile.create({ data: { chainId: chain.id } });
  await tx.chainBusinessProfile.update({
    where: { chainId: chain.id },
    data: { state: 'ACTIVE', version: { increment: 1 } },
  });
  for (const role of ['CHAIN_MANAGER', ...stages.map((s) => STAGE_ROLE[s])] as const) {
    const grant = await tx.scopedRoleGrant.create({
      data: {
        chainId: chain.id,
        organizationId: org.id,
        userId: row.ownerId,
        scope: 'CHAIN',
        role,
      },
    });
    await requestLedgerGrant(tx, grant);
  }
  await tx.chainAudit.create({
    data: {
      actorUserId: row.ownerId,
      operation: 'CREATE_PERSONAL_CHAIN',
      subjectId: chain.id,
      revision: 0,
      chainId: chain.id,
    },
  });
  return { chain, created: true };
}
