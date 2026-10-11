import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma, ScopedRole } from '../../generated/prisma/client.js';
import type {
  AuthorizedCommand,
  CommandActor,
} from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';

export const BUSINESS_CAPABILITIES = {
  FARM_STAFF: 'FARM',
  TRANSPORTER: 'TRANSPORTER',
  RETAILER: 'RETAILER',
  AUDITOR: 'AUDITOR',
  COMPLIANCE_REVIEWER: 'AUDITOR',
} as const;

export async function lockChainScope(db: Prisma.TransactionClient, id: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chain-scope:${id}`}, 0))`;
}

export async function organizationGrant(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  role: ScopedRole,
) {
  if (!actor.sub || !actor.organizationId) return null;
  return db.scopedRoleGrant.findFirst({
    where: {
      userId: actor.sub,
      organizationId: actor.organizationId,
      scope: 'ORGANIZATION',
      chainId: null,
      role,
      revokedAt: null,
    },
  });
}

export async function chainAccess(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  chainId: string,
) {
  const chain = await db.supplyChain.findUnique({ where: { id: chainId } });
  if (!chain || !actor.organizationId)
    throw new NotFoundException('Không tìm thấy chuỗi');
  const membership = await db.chainMembership.findUnique({
    where: {
      chainId_organizationId: { chainId, organizationId: actor.organizationId },
    },
  });
  if (!membership) throw new NotFoundException('Không tìm thấy chuỗi');
  const grants = await db.scopedRoleGrant.findMany({
    where: {
      userId: actor.sub ?? '',
      organizationId: actor.organizationId,
      chainId,
      scope: 'CHAIN',
      revokedAt: null,
    },
  });
  const admin = await organizationGrant(db, actor, 'ORG_ADMIN');
  if (!admin && (membership.status !== 'ACTIVE' || !grants.length))
    throw new NotFoundException('Không tìm thấy chuỗi');
  return { chain, membership, grants, admin };
}

/** New management commands are deliberately isolated from legacy global roles.
 * The caller's relevant grant and membership revision, not the whole role set,
 * determine replay scope. commandTransaction rechecks this under the scope lock. */
export async function authorizeChainCommand(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
  lock: boolean,
) {
  const actor = input.actor!;
  const payload = input.payload as Record<string, unknown>;
  const chainId = typeof payload.chainId === 'string' ? payload.chainId : null;
  if (lock) {
    // Org authority is locked before chain authority. Platform revocation uses
    // the target org, so it serializes with that org's in-flight commands too.
    const orgId = [
      'HYB_GRANT_ROLE',
      'HYB_REVOKE_ROLE',
      'HYB_SET_CAPABILITY',
    ].includes(input.operation)
      ? String(payload.organizationId)
      : actor.organizationId;
    if (
      ['HYB_GRANT_ROLE', 'HYB_REVOKE_ROLE', 'HYB_SET_CAPABILITY'].includes(
        input.operation,
      )
    ) {
      // The platform caller can belong to a different org (or no org). Its
      // actor locks alone do not serialize a recipient status UPDATE. Lock
      // the target org/user before reading their current status in the service;
      // FOR SHARE also conflicts with non-key status updates, unlike FK locks.
      await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${orgId}::uuid FOR SHARE`;
      if (input.operation === 'HYB_GRANT_ROLE') {
        const userId = String(payload.userId);
        await db.$queryRaw`SELECT user_id FROM app_user WHERE user_id = ${userId}::uuid FOR SHARE`;
      }
    }
    await lockChainScope(db, `org:${orgId ?? actor.sub!}`);
    if (chainId) await lockChainScope(db, chainId);
  }
  let permission: { id: string; revision: number } | null = null;
  let membership: {
    id: string;
    version: number;
    invitationRevision: number;
  } | null = null;
  if (
    ['HYB_GRANT_ROLE', 'HYB_REVOKE_ROLE', 'HYB_SET_CAPABILITY'].includes(
      input.operation,
    ) &&
    actor.role === 'SYSTEM_ADMIN'
  ) {
    // Platform administration does not create business-actor authority.
    return canonicalSha256({
      protocol: 'chain-management-v1',
      user: actor.sub,
      role: actor.role,
      chainId,
    });
  }
  if (input.operation === 'HYB_CREATE_CHAIN') {
    permission = await organizationGrant(db, actor, 'CREATE_CHAIN');
  } else if (
    ['HYB_GRANT_ROLE', 'HYB_REVOKE_ROLE', 'HYB_SET_CAPABILITY'].includes(
      input.operation,
    )
  ) {
    permission = await organizationGrant(db, actor, 'ORG_ADMIN');
    if (payload.organizationId !== actor.organizationId)
      throw new ForbiddenException('Ngoài phạm vi tổ chức');
    if (input.operation === 'HYB_SET_CAPABILITY' && payload.code === 'AUDITOR')
      throw new ForbiddenException('Năng lực kiểm định do nền tảng cấp');
    if (
      input.operation === 'HYB_GRANT_ROLE' &&
      !['FARM_STAFF', 'TRANSPORTER', 'RETAILER'].includes(String(payload.role))
    )
      throw new ForbiddenException(
        'Org admin chỉ cấp vai trò thực hiện nghiệp vụ',
      );
  } else {
    if (!chainId) throw new ForbiddenException('Thiếu phạm vi chuỗi');
    const access = await chainAccess(db, actor, chainId);
    membership = access.membership;
    if (input.operation === 'HYB_ACCEPT_MEMBERSHIP') {
      if (payload.organizationId !== actor.organizationId)
        throw new ForbiddenException('Không xác nhận thay đối tác');
      if (!['INVITED', 'ACTIVE'].includes(access.membership.status))
        throw new ForbiddenException('Lời mời không còn hiệu lực');
      permission = access.admin;
    } else if (
      ['HYB_INVITE_MEMBERSHIP', 'HYB_CHANGE_MEMBERSHIP'].includes(
        input.operation,
      )
    ) {
      if (
        access.chain.ownerOrganizationId !== actor.organizationId ||
        access.membership.status !== 'ACTIVE'
      )
        throw new ForbiddenException('Chỉ chủ chuỗi được điều phối thành viên');
      permission =
        access.grants.find((g) => g.role === 'CHAIN_MANAGER') ?? null;
    } else throw new ForbiddenException('Command chuỗi chưa có policy');
  }
  if (!permission)
    throw new ForbiddenException('Chưa được cấp quyền trong phạm vi này');
  return canonicalSha256({
    protocol: 'chain-management-v1',
    user: actor.sub,
    organization: actor.organizationId,
    chainId,
    permission: { id: permission.id, revision: permission.revision },
    // Acceptance survives its own status transition, but never a new invitation.
    ...(membership
      ? {
          membership:
            input.operation === 'HYB_ACCEPT_MEMBERSHIP'
              ? {
                  id: membership.id,
                  invitationRevision: membership.invitationRevision,
                }
              : { id: membership.id, version: membership.version },
        }
      : {}),
  });
}
