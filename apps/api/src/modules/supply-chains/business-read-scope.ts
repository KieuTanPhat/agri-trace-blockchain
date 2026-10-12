import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { BUSINESS_CAPABILITIES } from './chain-policy.js';
import { trustedLegacyCycleWhere } from './legacy-scope-pins.js';

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
  return {
    AND: [trustedLegacyCycleWhere()],
    chain: { is: chainAuthority(actor, role) },
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
  return { OR: READ_ROLES.map((role) => lotForRole(actor, role)) };
}

export function scopedShipmentReadWhere(
  actor: CommandActor,
): Prisma.ShipmentWhereInput {
  if (!permitted(actor)) return { id: NONE };
  return { lot: scopedLotReadWhere(actor) };
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
  return permitted(actor) ? cycleForRole(actor, role) : { id: NONE };
}

export function legacyOrScopedCycle(
  actor: CommandActor,
  legacy: Prisma.ProductionCycleWhereInput = {},
): Prisma.ProductionCycleWhereInput {
  return {
    OR: [
      {
        AND: [
          { chainId: null, organization: { businessScope: { is: null } } },
          legacy,
        ],
      },
      scopedCycleReadWhere(actor),
    ],
  };
}
export function legacyOrScopedLot(
  actor: CommandActor,
  legacy: Prisma.LotWhereInput = {},
): Prisma.LotWhereInput {
  return {
    OR: [
      {
        AND: [
          {
            harvest: {
              cycle: {
                chainId: null,
                organization: { businessScope: { is: null } },
              },
            },
          },
          legacy,
        ],
      },
      scopedLotReadWhere(actor),
    ],
  };
}
export function legacyOrScopedShipment(
  actor: CommandActor,
  legacy: Prisma.ShipmentWhereInput = {},
): Prisma.ShipmentWhereInput {
  return {
    OR: [
      {
        AND: [
          {
            lot: {
              harvest: {
                cycle: {
                  chainId: null,
                  organization: { businessScope: { is: null } },
                },
              },
            },
          },
          legacy,
        ],
      },
      scopedShipmentReadWhere(actor),
    ],
  };
}
