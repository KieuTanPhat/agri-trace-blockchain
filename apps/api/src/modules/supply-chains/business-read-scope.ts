import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { BUSINESS_CAPABILITIES } from './chain-policy.js';

const NONE = '00000000-0000-0000-0000-000000000000';
const READ_ROLES = [
  'FARM_STAFF',
  'TRANSPORTER',
  'RETAILER',
  'AUDITOR',
  'COMPLIANCE_REVIEWER',
] as const;
type ReadRole = (typeof READ_ROLES)[number];

function chainAuthority(
  actor: CommandActor,
  role: ReadRole,
): Prisma.SupplyChainWhereInput {
  return {
    businessProfile: { is: { state: 'ACTIVE', scopeVersion: 1 } },
    memberships: {
      some: { organizationId: actor.organizationId!, status: 'ACTIVE' },
    },
    grants: {
      some: {
        userId: actor.sub!,
        organizationId: actor.organizationId!,
        scope: 'CHAIN',
        role,
        revokedAt: null,
        user: {
          accountStatus: 'ACTIVE',
          organizationId: actor.organizationId!,
        },
        organization: {
          status: 'ACTIVE',
          capabilities: {
            some: { code: BUSINESS_CAPABILITIES[role], revokedAt: null },
          },
        },
      },
    },
  };
}

function assignment(
  actor: CommandActor,
  stage: 'PRODUCTION' | 'TRANSPORT' | 'RETAIL',
): Prisma.StageAssignmentWhereInput {
  return { organizationId: actor.organizationId!, stage, status: 'ACCEPTED' };
}

function cycleForRole(
  actor: CommandActor,
  role: ReadRole,
): Prisma.ProductionCycleWhereInput {
  const scope = actor.enterpriseScope;
  const permissions =
    role === 'FARM_STAFF'
      ? ['production.read', 'production.write', 'trace.read']
      : ['distribution.read', 'distribution.write', 'distribution.sign', 'trace.read'];
  const grants = scope?.roleScopes.filter((grant) =>
    grant.permissions.some((permission) => permissions.includes(permission)),
  );
  const delegatedScope: Prisma.ProductionCycleWhereInput | undefined = scope
    ? !grants?.length
      ? { id: NONE }
      : role === 'FARM_STAFF'
        ? {
            OR: grants.map((grant) => ({
              AND: [
                { chainId: { in: grant.chainIds } },
                { farmId: { in: grant.siteIds } },
              ],
            })),
          }
        : { OR: grants.map((grant) => ({ chainId: { in: grant.chainIds } })) }
    : undefined;
  return {
    chain: { is: chainAuthority(actor, role) },
    ...delegatedScope,
    ...(role === 'FARM_STAFF'
      ? { assignments: { some: assignment(actor, 'PRODUCTION') } }
      : role === 'COMPLIANCE_REVIEWER'
        ? {
            farmOrgId: { not: actor.organizationId! },
            farm: {
              complianceAssignments: {
                some: { reviewerUserId: actor.sub!, revokedAt: null },
              },
            },
          }
        : {}),
  };
}

function lotForRole(actor: CommandActor, role: ReadRole): Prisma.LotWhereInput {
  return {
    harvest: { cycle: cycleForRole(actor, role) },
    ...(role === 'TRANSPORTER'
      ? {
          shipment: {
            is: { stageAssignments: { some: assignment(actor, 'TRANSPORT') } },
          },
        }
      : role === 'RETAILER'
        ? { stageAssignments: { some: assignment(actor, 'RETAIL') } }
        : {}),
  };
}

/** Lots made by the actor's own processing runs. They have no harvest, so the
 * role branches above never match them. Delegated members see only runs at
 * the chains and sites their processing/trace grants name. */
function processedLots(actor: CommandActor): Prisma.LotWhereInput {
  const scope = actor.enterpriseScope;
  const grants = scope?.roleScopes.filter((grant) =>
    grant.permissions.some((permission) =>
      ['processing.read', 'processing.write', 'trace.read'].includes(permission),
    ),
  );
  const delegated: Prisma.ProcessingRunWhereInput = scope
    ? !grants?.length
      ? { id: NONE }
      : {
          OR: grants.map((grant) => ({
            chainId: { in: grant.chainIds },
            siteId: { in: grant.siteIds },
          })),
        }
    : {};
  return {
    originType: 'TRANSFORMATION',
    farmOrgId: actor.organizationId!,
    organization: {
      status: 'ACTIVE',
      capabilities: { some: { code: 'PROCESSOR', revokedAt: null } },
    },
    processingRun: {
      is: {
        organizationId: actor.organizationId!,
        status: 'COMPLETED',
        ...delegated,
        chain: {
          is: {
            businessProfile: { is: { state: 'ACTIVE', scopeVersion: 1 } },
            memberships: {
              some: { organizationId: actor.organizationId!, status: 'ACTIVE' },
            },
          },
        },
      },
    },
  };
}

function permitted(actor: CommandActor) {
  return Boolean(
    actor.sub && actor.organizationId && actor.role !== 'SYSTEM_ADMIN',
  );
}

/** SQL filters for private core reads. Caller filters and these
 * predicates must be composed with AND. A manager needs a separate projection;
 * ownership and platform metadata authority do not grant raw business reads. */
export function scopedLotReadWhere(actor: CommandActor): Prisma.LotWhereInput {
  if (!permitted(actor)) return { id: NONE };
  return {
    OR: [...READ_ROLES.map((role) => lotForRole(actor, role)), processedLots(actor)],
  };
}

export function scopedShipmentReadWhere(
  actor: CommandActor,
): Prisma.ShipmentWhereInput {
  if (!permitted(actor)) return { id: NONE };
  return { lot: scopedLotReadWhere(actor) };
}

/** Apply scope to the final evidence query as well as its preliminary check. */
export function scopedTraceEventReadWhere(
  actor: CommandActor,
): Prisma.TraceEventWhereInput {
  if (!permitted(actor)) return { id: NONE };
  return {
    OR: [
      { lotId: { not: null }, lot: { is: scopedLotReadWhere(actor) } },
      {
        lotId: null,
        cycleId: { not: null },
        cycle: { is: scopedCycleReadWhere(actor) },
      },
    ],
  };
}

/** Parent visibility does not authorize every child. Cycle detail must also
 * apply scopedLotReadWhere to harvest/Lot relations and scope each export,
 * count, proof and IoT relation. Never include all Lots after this filter. */
export function scopedCycleReadWhere(
  actor: CommandActor,
): Prisma.ProductionCycleWhereInput {
  if (!permitted(actor)) return { id: NONE };
  return {
    OR: READ_ROLES.map((role) => ({
      ...cycleForRole(actor, role),
      ...(['TRANSPORTER', 'RETAILER'].includes(role)
        ? { harvestEvents: { some: { lot: { is: lotForRole(actor, role) } } } }
        : {}),
    })),
  };
}

/** A specific current role for UI command projections, not the union of
 * every readable role. Writes still recheck command authority under locks. */
export function scopedCycleRoleReadWhere(
  actor: CommandActor,
  role: 'FARM_STAFF' | 'COMPLIANCE_REVIEWER',
): Prisma.ProductionCycleWhereInput {
  return permitted(actor)
    ? {
        ...cycleForRole(actor, role),
      }
    : { id: NONE };
}
