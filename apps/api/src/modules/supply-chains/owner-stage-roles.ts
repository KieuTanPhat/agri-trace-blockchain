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
  return ensureStageRoles(tx, chain, chain.ownerOrganizationId, userId, false, 'GRANT_OWNER_STAGE_ROLE');
}

/**
 * A partner accepting a chain invitation works its stages too: the accepting
 * administrator receives the business role of each stage the model gives it,
 * or of each approved supply capability when the model does not name it
 * (it joined later). Fresh grants only: a suspension's revoked grants never
 * revive.
 */
export async function ensureMemberStageRoles(
  tx: Prisma.TransactionClient,
  chain: { id: string; supplyModel: unknown },
  organizationId: string,
  userId: string,
) {
  return ensureStageRoles(tx, chain, organizationId, userId, true, 'GRANT_MEMBER_STAGE_ROLE');
}

async function ensureStageRoles(
  tx: Prisma.TransactionClient,
  chain: { id: string; supplyModel: unknown },
  organizationId: string,
  userId: string,
  anyCapability: boolean,
  operation: string,
) {
  const named = modelStages(chain.supplyModel, organizationId);
  const stages: readonly Stage[] = named.length || !anyCapability ? named : SUPPLY_STAGES;
  if (!stages.length) return [];
  const capabilities = await tx.organizationCapability.findMany({
    where: { organizationId, revokedAt: null, code: { in: [...stages] } },
    select: { code: true },
  });
  const roles = [...new Set(stages.filter((s) => capabilities.some((c) => c.code === s)).map((s) => STAGE_ROLE[s]))];
  const created: string[] = [];
  for (const role of roles) {
    const existing = await tx.scopedRoleGrant.findFirst({
      where: { chainId: chain.id, organizationId, userId, scope: 'CHAIN', role, revokedAt: null },
      select: { id: true },
    });
    if (existing) continue;
    const grant = await tx.scopedRoleGrant.create({
      data: { chainId: chain.id, organizationId, userId, scope: 'CHAIN', role },
    });
    await tx.chainAudit.create({
      data: { chainId: chain.id, actorUserId: userId, operation, subjectId: grant.id, revision: 0 },
    });
    await requestLedgerGrant(tx, grant);
    created.push(role);
  }
  return created;
}
