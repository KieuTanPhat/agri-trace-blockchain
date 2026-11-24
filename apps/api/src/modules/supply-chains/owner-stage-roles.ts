import type { Prisma } from '../../generated/prisma/client.js';
import { requestLedgerGrant } from '../ledger/ledger-permissions.js';
import { SUPPLY_STAGES } from './dto.js';
import { STAGE_ROLE } from './personal-chain.js';

type Stage = (typeof SUPPLY_STAGES)[number];

/** Stages the supply model assigns to an organization. */
export function modelStages(supplyModel: unknown, organizationId: string): Stage[] {
  const stages = (supplyModel as { stages?: { stage?: string; organizationIds?: string[] }[] } | null)?.stages ?? [];
  return SUPPLY_STAGES.filter((stage) =>
    stages.some((s) => s.stage === stage && (s.organizationIds ?? []).includes(organizationId)),
  );
}

/**
 * The chain owner works the stages its own organization takes in the supply
 * model: it holds the business role of each of them whose capability is
 * approved, beside CHAIN_MANAGER (like the personal ledger). Idempotent; inside
 * the caller's transaction. Each new grant is queued for ledger confirmation
 * (or confirmed later by binding activation) and audited on the chain.
 */
export async function ensureOwnerStageRoles(
  tx: Prisma.TransactionClient,
  chain: { id: string; ownerOrganizationId: string; supplyModel: unknown },
  userId: string,
) {
  const stages = modelStages(chain.supplyModel, chain.ownerOrganizationId);
  if (!stages.length) return [];
  const capabilities = await tx.organizationCapability.findMany({
    where: { organizationId: chain.ownerOrganizationId, revokedAt: null, code: { in: stages } },
    select: { code: true },
  });
  const roles = [...new Set(stages.filter((s) => capabilities.some((c) => c.code === s)).map((s) => STAGE_ROLE[s]))];
  const created: string[] = [];
  for (const role of roles) {
    const existing = await tx.scopedRoleGrant.findFirst({
      where: { chainId: chain.id, organizationId: chain.ownerOrganizationId, userId, scope: 'CHAIN', role, revokedAt: null },
      select: { id: true },
    });
    if (existing) continue;
    const grant = await tx.scopedRoleGrant.create({
      data: { chainId: chain.id, organizationId: chain.ownerOrganizationId, userId, scope: 'CHAIN', role },
    });
    await tx.chainAudit.create({
      data: { chainId: chain.id, actorUserId: userId, operation: 'GRANT_OWNER_STAGE_ROLE', subjectId: grant.id, revision: 0 },
    });
    await requestLedgerGrant(tx, grant);
    created.push(role);
  }
  return created;
}
