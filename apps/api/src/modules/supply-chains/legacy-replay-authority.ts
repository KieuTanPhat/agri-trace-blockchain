import type { Prisma } from '../../generated/prisma/client.js';

export type LegacyReplayActor = {
  userId: string;
  organizationId: string;
  role: string;
  grantId?: string;
  grantRevision?: number;
  reviewerAssignmentId?: string;
  deviceId?: string;
  authorityRevision?: number;
  bindingId?: string | null;
};

/** Called under the cutover authority locks and history fence. These are
 * replay witnesses, never grants, participant consents or business signatures. */
export async function captureLegacyReplayActors(
  db: Prisma.TransactionClient,
  chainId: string,
  cycleId: string,
  parties: Array<{
    id: string;
    userId: string;
    organizationId: string;
    role: string;
    revision: number;
  }>,
): Promise<LegacyReplayActor[]> {
  const root = await db.productionCycle.findUniqueOrThrow({
    where: { id: cycleId },
  });
  const actors: LegacyReplayActor[] = parties.map((g) => ({
    userId: g.userId,
    organizationId: g.organizationId,
    role: g.role,
    grantId: g.id,
    grantRevision: g.revision,
  }));
  const reviewers = await db.scopedRoleGrant.findMany({
    where: {
      chainId,
      scope: 'CHAIN',
      role: 'COMPLIANCE_REVIEWER',
      revokedAt: null,
      organizationId: { not: root.farmOrgId },
      membership: { status: 'ACTIVE' },
      organization: {
        status: 'ACTIVE',
        capabilities: { some: { code: 'AUDITOR', revokedAt: null } },
      },
      user: {
        accountStatus: 'ACTIVE',
        role: { code: { not: 'SYSTEM_ADMIN' } },
        complianceAssignments: {
          some: { farmId: root.farmId, revokedAt: null },
        },
      },
    },
    include: {
      user: {
        select: {
          organizationId: true,
          complianceAssignments: {
            where: { farmId: root.farmId, revokedAt: null },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  for (const g of reviewers) {
    if (g.user.organizationId !== g.organizationId) continue;
    actors.push({
      userId: g.userId,
      organizationId: g.organizationId,
      role: g.role,
      grantId: g.id,
      grantRevision: g.revision,
      reviewerAssignmentId: g.user.complianceAssignments[0].id,
    });
  }
  const devices = await db.iotDevice.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { cycleId, organizationId: root.farmOrgId },
        {
          trackingBindings: {
            some: {
              status: 'ACTIVE',
              unboundAt: null,
              shipment: { lot: { harvest: { cycleId } } },
            },
          },
        },
      ],
    },
    include: {
      trackingBindings: {
        where: {
          status: 'ACTIVE',
          unboundAt: null,
          shipment: { lot: { harvest: { cycleId } } },
        },
        select: { id: true, transporterOrgId: true },
      },
    },
    orderBy: { id: 'asc' },
  });
  for (const device of devices) {
    const bindings = [
      ...(device.cycleId === cycleId && device.organizationId === root.farmOrgId
        ? [null]
        : []),
      ...device.trackingBindings.filter(
        (b) => b.transporterOrgId === device.organizationId,
      ),
    ];
    for (const binding of bindings)
      for (const requester of new Set([device.id, device.deviceCode]))
        actors.push({
          userId: `device:${requester}`,
          organizationId: device.organizationId,
          role: 'IOT_DEVICE',
          deviceId: device.id,
          authorityRevision: device.authorityRevision,
          bindingId: binding?.id ?? null,
        });
  }
  return actors;
}
