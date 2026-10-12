import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { BUSINESS_CAPABILITIES, lockChainScope } from './chain-policy.js';
import { assertLegacyScopeProvenance } from './legacy-scope-pins.js';

export type BusinessRole = keyof typeof BUSINESS_CAPABILITIES | 'CHAIN_MANAGER';
export type BusinessSubject =
  | { kind: 'cycle'; id: string }
  | { kind: 'lot'; id: string }
  | { kind: 'shipment'; id: string };

/** Resolve from persisted relations. A request's chainId is only an assertion,
 * never the source of an existing resource's scope. */
export async function businessRoot(
  db: Prisma.TransactionClient,
  subject: BusinessSubject,
) {
  if (subject.kind === 'cycle') {
    const cycle = await db.productionCycle.findUnique({
      where: { id: subject.id },
      select: { id: true, chainId: true, farmOrgId: true, farmId: true },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy đối tượng');
    await assertLegacyScopeProvenance(db, cycle.id);
    return { cycle, lotId: null, shipmentId: null };
  }
  const lot = await db.lot.findFirst({
    where:
      subject.kind === 'lot'
        ? { id: subject.id }
        : { shipment: { id: subject.id } },
    select: {
      id: true,
      harvest: {
        select: {
          cycle: {
            select: { id: true, chainId: true, farmOrgId: true, farmId: true },
          },
        },
      },
      shipment: { select: { id: true } },
    },
  });
  if (!lot) throw new NotFoundException('Không tìm thấy đối tượng');
  await assertLegacyScopeProvenance(db, lot.harvest.cycle.id);
  return {
    cycle: lot.harvest.cycle,
    lotId: lot.id,
    shipmentId: lot.shipment?.id ?? null,
  };
}

/** Candidate command policy, not yet connected to core endpoints. The caller
 * must authenticate the session and select the required role from the command,
 * not from request data. `lock` requires an enclosing domain transaction.
 * Reads need SQL scope filters as well; this function is not a list filter. */
export async function authorizeBusinessCommand(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  requirement: {
    chainId: string;
    role: BusinessRole;
    subject?: BusinessSubject;
  },
  lock = false,
) {
  if (!actor.sub || !actor.organizationId || actor.role === 'SYSTEM_ADMIN')
    throw new ForbiddenException('Chưa có quyền nghiệp vụ trong chuỗi');
  const { chainId, role, subject } = requirement;
  if (lock) {
    await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${actor.organizationId}::uuid FOR SHARE`;
    await db.$queryRaw`SELECT user_id FROM app_user WHERE user_id = ${actor.sub}::uuid FOR SHARE`;
    await lockChainScope(db, `org:${actor.organizationId}`);
    await lockChainScope(db, chainId);
    await db.$queryRaw`SELECT chain_id FROM chain_business_profile WHERE chain_id = ${chainId}::uuid FOR SHARE`;
    await db.$queryRaw`SELECT membership_id FROM chain_membership WHERE chain_id = ${chainId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR SHARE`;
    await db.$queryRaw`SELECT grant_id FROM scoped_role_grant WHERE chain_id = ${chainId}::uuid AND organization_id = ${actor.organizationId}::uuid AND user_id = ${actor.sub}::uuid AND role::text = ${role} AND revoked_at IS NULL FOR SHARE`;
  }
  const user = await db.user.findUnique({
    where: { id: actor.sub },
    select: { accountStatus: true, organizationId: true, organization: true },
  });
  if (
    !user ||
    user.accountStatus !== 'ACTIVE' ||
    user.organizationId !== actor.organizationId ||
    user.organization?.status !== 'ACTIVE'
  )
    throw new ForbiddenException('Tài khoản hoặc tổ chức không hoạt động');
  const profile = await db.chainBusinessProfile.findUnique({
    where: { chainId },
    include: { chain: { select: { ownerOrganizationId: true } } },
  });
  const membership = await db.chainMembership.findUnique({
    where: {
      chainId_organizationId: { chainId, organizationId: actor.organizationId },
    },
  });
  const grant = await db.scopedRoleGrant.findFirst({
    where: {
      userId: actor.sub,
      organizationId: actor.organizationId,
      chainId,
      scope: 'CHAIN',
      role,
      revokedAt: null,
    },
  });
  if (
    !profile ||
    profile.state !== 'ACTIVE' ||
    profile.scopeVersion !== 1 ||
    membership?.status !== 'ACTIVE' ||
    !grant
  )
    throw new ForbiddenException('Chưa có quyền nghiệp vụ trong chuỗi');
  if (
    role === 'CHAIN_MANAGER' &&
    profile.chain.ownerOrganizationId !== actor.organizationId
  )
    throw new ForbiddenException('Chỉ chủ chuỗi được điều phối');
  const code = role === 'CHAIN_MANAGER' ? null : BUSINESS_CAPABILITIES[role];
  if (lock && code)
    await db.$queryRaw`SELECT organization_id FROM organization_capability WHERE organization_id = ${actor.organizationId}::uuid AND code::text = ${code} FOR SHARE`;
  const capability = code
    ? await db.organizationCapability.findUnique({
        where: {
          organizationId_code: { organizationId: actor.organizationId, code },
        },
      })
    : null;
  if (code && (!capability || capability.revokedAt))
    throw new ForbiddenException('Tổ chức chưa có năng lực phù hợp');

  const root = subject ? await businessRoot(db, subject) : null;
  if (root && root.cycle.chainId !== chainId)
    throw new NotFoundException('Không tìm thấy đối tượng trong chuỗi');
  // A capability or a different employee never makes producer self-review
  // independent. This check is in addition to assignment/grant validation.
  if (
    role === 'COMPLIANCE_REVIEWER' &&
    (!root || root.cycle.farmOrgId === actor.organizationId)
  )
    throw new ForbiddenException(
      'Không được kiểm định sản phẩm của tổ chức mình',
    );
  let reviewerAssignmentId: string | null = null;
  if (role === 'COMPLIANCE_REVIEWER' && root) {
    if (lock)
      await db.$queryRaw`SELECT assignment_id FROM compliance_assignment WHERE reviewer_user_id = ${actor.sub}::uuid AND farm_id = ${root.cycle.farmId}::uuid AND revoked_at IS NULL FOR SHARE`;
    const assigned = await db.complianceAssignment.findFirst({
      where: {
        reviewerUserId: actor.sub,
        farmId: root.cycle.farmId,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!assigned)
      throw new ForbiddenException('Reviewer chưa được phân công nông trại');
    reviewerAssignmentId = assigned.id;
  }
  let assignment: { id: string; version: number } | null = null;
  if (root && ['FARM_STAFF', 'TRANSPORTER', 'RETAILER'].includes(role)) {
    const where: Prisma.StageAssignmentWhereInput = {
      chainId,
      organizationId: actor.organizationId,
      status: 'ACCEPTED',
      ...(role === 'FARM_STAFF'
        ? { stage: 'PRODUCTION', cycleId: root.cycle.id }
        : role === 'TRANSPORTER'
          ? { stage: 'TRANSPORT', shipmentId: root.shipmentId ?? '' }
          : { stage: 'RETAIL', lotId: root.lotId ?? '' }),
    };
    // An absent subject for this stage must deny, not generate an invalid UUID
    // query or match another assignment in the same chain.
    if (
      (role === 'TRANSPORTER' && !root.shipmentId) ||
      (role === 'RETAILER' && !root.lotId)
    )
      throw new ForbiddenException('Chưa được phân công công đoạn');
    assignment = await db.stageAssignment.findFirst({ where });
    if (!assignment)
      throw new ForbiddenException('Chưa được phân công công đoạn');
    if (lock)
      await db.$queryRaw`SELECT assignment_id FROM stage_assignment WHERE assignment_id = ${assignment.id}::uuid FOR SHARE`;
    // All assignment commands must acquire the chain lock. Re-read after the
    // row lock too, so a direct status change cannot pass the earlier lookup.
    if (lock) {
      assignment = await db.stageAssignment.findFirst({ where });
      if (!assignment) throw new ForbiddenException('Phân công đã thay đổi');
    }
  }
  return {
    chainId,
    actor: { ...actor, role },
    grant,
    membership,
    assignment,
    reviewerAssignmentId,
    scope: canonicalSha256({
      protocol: 'chain-business-v1',
      user: actor.sub,
      organization: actor.organizationId,
      chainId,
      role,
      profile: { scopeVersion: profile.scopeVersion, version: profile.version },
      membership: { id: membership.id, version: membership.version },
      grant: { id: grant.id, revision: grant.revision },
      ...(capability
        ? {
            capability: {
              code: capability.code,
              revision: capability.revision,
            },
          }
        : {}),
      ...(assignment
        ? { assignment: { id: assignment.id, version: assignment.version } }
        : {}),
      ...(reviewerAssignmentId ? { reviewerAssignmentId } : {}),
      ...(subject ? { subject } : {}),
    }),
  };
}
