import type { Prisma } from '../../generated/prisma/client.js';
import type { LegacyScopeManifest } from './legacy-scope-manifest.js';

/** Only after artifact/inventory/pin validation in the same read-only snapshot.
 * Verify actual operator and owner authority; no role/grant/assignment is
 * inferred or provisioned by the manifest. This does not authorize apply. */
export async function preflightLegacyScope(
  db: Prisma.TransactionClient,
  manifest: LegacyScopeManifest,
) {
  const [operator, reviewer] = await Promise.all([
    db.user.findUnique({
      where: { id: manifest.operatorId },
      select: {
        id: true,
        accountStatus: true,
        organizationId: true,
        role: { select: { code: true } },
        organization: { select: { status: true } },
      },
    }),
    db.user.findUnique({
      where: { id: manifest.reviewerId },
      select: {
        id: true,
        accountStatus: true,
        organizationId: true,
        role: { select: { code: true } },
        organization: { select: { status: true } },
      },
    }),
  ]);
  if (
    !operator ||
    operator.accountStatus !== 'ACTIVE' ||
    operator.role.code !== 'SYSTEM_ADMIN' ||
    (operator.organizationId && operator.organization?.status !== 'ACTIVE')
  )
    throw new Error(
      'Legacy scope preflight requires an active platform operator',
    );
  if (
    !reviewer ||
    reviewer.id === operator.id ||
    reviewer.accountStatus !== 'ACTIVE' ||
    reviewer.role.code === 'SYSTEM_ADMIN' ||
    !reviewer.organizationId ||
    reviewer.organization?.status !== 'ACTIVE'
  )
    throw new Error(
      'Legacy scope preflight requires a separate active business owner reviewer',
    );
  let mapped = 0;
  const chains = new Set<string>();
  for (const entry of manifest.entries) {
    if (entry.decision !== 'MAP') continue;
    const chainId = entry.chainId!;
    const profile = await db.chainBusinessProfile.findUnique({
      where: { chainId },
      include: { chain: true },
    });
    if (
      !profile ||
      profile.state !== 'PREPARING' ||
      profile.scopeVersion !== 1 ||
      profile.chain.ownerOrganizationId !== reviewer.organizationId
    )
      throw new Error(
        'Legacy scope preflight requires the reviewed owner and PREPARING target',
      );
    if (
      !(await db.scopedRoleGrant.findFirst({
        where: {
          chainId,
          userId: reviewer.id,
          organizationId: reviewer.organizationId,
          scope: 'CHAIN',
          role: 'CHAIN_MANAGER',
          revokedAt: null,
          membership: { status: 'ACTIVE' },
        },
      }))
    )
      throw new Error(
        'Legacy scope preflight lacks current owner coordination grant',
      );
    const cycle = await db.productionCycle.findUnique({
      where: { id: entry.cycleId },
      include: {
        harvestEvents: { include: { lot: { include: { shipment: true } } } },
      },
    });
    if (
      !cycle ||
      cycle.chainId !== null ||
      cycle.version !== entry.expectedVersion ||
      cycle.farmOrgId !== entry.producerOrgId
    )
      throw new Error('Legacy scope preflight root changed');
    const parties = new Map<
      string,
      {
        organizationId: string;
        role: 'FARM_STAFF' | 'TRANSPORTER' | 'RETAILER';
        code: 'FARM' | 'TRANSPORTER' | 'RETAILER';
      }
    >();
    const add = (
      organizationId: string,
      role: 'FARM_STAFF' | 'TRANSPORTER' | 'RETAILER',
      code: 'FARM' | 'TRANSPORTER' | 'RETAILER',
    ) =>
      parties.set(`${organizationId}:${role}`, { organizationId, role, code });
    add(cycle.farmOrgId, 'FARM_STAFF', 'FARM');
    for (const harvest of cycle.harvestEvents)
      if (harvest.lot?.shipment) {
        add(
          harvest.lot.shipment.transporterOrgId,
          'TRANSPORTER',
          'TRANSPORTER',
        );
        add(harvest.lot.shipment.retailerOrgId, 'RETAILER', 'RETAILER');
      }
    for (const party of parties.values()) {
      const member = await db.chainMembership.findUnique({
        where: {
          chainId_organizationId: {
            chainId,
            organizationId: party.organizationId,
          },
        },
        include: { organization: true },
      });
      const capability = await db.organizationCapability.findUnique({
        where: {
          organizationId_code: {
            organizationId: party.organizationId,
            code: party.code,
          },
        },
      });
      if (
        member?.status !== 'ACTIVE' ||
        member.organization.status !== 'ACTIVE' ||
        !capability ||
        capability.revokedAt
      )
        throw new Error(
          'Legacy scope preflight participant membership/capability unavailable',
        );
      if (
        !(await db.scopedRoleGrant.findFirst({
          where: {
            chainId,
            organizationId: party.organizationId,
            scope: 'CHAIN',
            role: party.role,
            revokedAt: null,
            user: {
              accountStatus: 'ACTIVE',
              organizationId: party.organizationId,
              role: { code: { not: 'SYSTEM_ADMIN' } },
            },
          },
        }))
      )
        throw new Error(
          'Legacy scope preflight lacks an explicit current actor grant',
        );
    }
    mapped += 1;
    chains.add(chainId);
  }
  return { mapped, chains: [...chains].sort(), applyReady: false as const };
}
