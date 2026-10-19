import { ForbiddenException } from '@nestjs/common';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import type {
  AuthorizedCommand,
  CommandActor,
} from '../../common/idempotency/command-authorization.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { evidenceSubject } from './evidence-policy.js';
import { lockChainScope } from '../supply-chains/chain-policy.js';

export const ENTERPRISE_PERMISSIONS = [
  'profile.read',
  'members.read',
  'members.manage',
  'roles.manage',
  'partners.read',
  'partners.manage',
  'catalog.read',
  'catalog.manage',
  'sites.read',
  'sites.manage',
  'vehicles.read',
  'vehicles.manage',
  'production.read',
  'production.write',
  'distribution.read',
  'distribution.write',
  'distribution.sign',
  'trace.read',
  'qr.manage',
  'reports.read',
  'quantity.adjust',
  'profile.manage',
  'cases.read',
  'cases.respond',
  'inventory.manage',
  'quarantine.manage',
  'evidence.read',
  'evidence.manage',
  'materials.read',
  'materials.manage',
] as const;
export type EnterprisePermission = (typeof ENTERPRISE_PERMISSIONS)[number];

export function enterpriseTransferWhere(
  actor: CommandActor,
  auth: Awaited<ReturnType<typeof enterpriseAuthority>>,
  permission: EnterprisePermission = 'distribution.read',
): Prisma.DistributionTransferWhereInput {
  const organizationId = actor.organizationId!;
  const participant = {
    OR: [
      { senderId: organizationId },
      { carrierId: organizationId },
      { receiverId: organizationId },
    ],
  };
  if (auth.primary) return participant;
  return {
    AND: [
      participant,
      {
        OR: auth.user.enterpriseRoles
          .filter((r) => r.role.permissions.includes(permission))
          .map((r) => ({
            chainId: { in: r.chainIds },
            OR: [
              { senderId: organizationId, senderSiteId: { in: r.siteIds } },
              { carrierId: organizationId, carrierSiteId: { in: r.siteIds } },
              { receiverId: organizationId, receiverSiteId: { in: r.siteIds } },
            ],
          })),
      },
    ],
  };
}

/** All enterprise mutations take the same lock, including delegation/revocation.
 * This lock is also held by business writes so a revoked scope cannot race one. */
export async function enterpriseAuthority(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  permission: EnterprisePermission,
  chainId?: string,
  siteId?: string,
  lock = false,
) {
  if (
    !actor.organizationId ||
    !actor.sub ||
    ['SYSTEM_ADMIN', 'AUDITOR', 'COMPLIANCE_REVIEWER', 'IOT_DEVICE'].includes(
      actor.role,
    )
  )
    throw new ForbiddenException('Chức năng dành cho thành viên doanh nghiệp');
  if (lock)
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise:${actor.organizationId}`},0))`;
  const user = await db.user.findUnique({
    where: { id: actor.sub },
    include: {
      organization: {
        include: { enterpriseEnrollment: { include: { serviceOrder: true } } },
      },
      enterpriseRoles: { include: { role: true } },
    },
  });
  if (
    !user ||
    user.organizationId !== actor.organizationId ||
    user.accountStatus !== 'ACTIVE' ||
    user.organization?.status !== 'ACTIVE' ||
    (user.organization.enterpriseEnrollment &&
      (user.organization.enterpriseEnrollment.status !== 'APPROVED' ||
        (user.organization.enterpriseEnrollment.activationRequired &&
          !user.organization.enterpriseEnrollment.serviceActivatedAt)))
  )
    throw new ForbiddenException(
      'Doanh nghiệp chưa được duyệt hoặc tài khoản đã bị thu hồi',
    );
  const admin = await db.scopedRoleGrant.findFirst({
    where: {
      userId: user.id,
      organizationId: actor.organizationId,
      scope: 'ORGANIZATION',
      role: 'ORG_ADMIN',
      revokedAt: null,
    },
  });
  const primary =
    !!admin && (user.enterpriseTier === null || user.enterpriseTier === 1);
  const matching = user.enterpriseRoles.filter(
    (r) =>
      r.role.permissions.includes(permission) &&
      (!chainId || r.chainIds.includes(chainId)) &&
      (!siteId || r.siteIds.includes(siteId)),
  );
  if (!primary && !matching.length)
    throw new ForbiddenException(
      'Bạn chưa được cấp quyền hoặc phạm vi cho thao tác này',
    );
  if (
    ['members.manage', 'roles.manage'].includes(permission) &&
    user.enterpriseTier === 3
  )
    throw new ForbiddenException(
      'Tài khoản cấp 3 không được quản trị thành viên',
    );
  const ancestry: unknown[] = [];
  let supervisorId =
    user.enterpriseTier && user.enterpriseTier > 1 ? user.supervisorId : null;
  for (let depth = 0; supervisorId && depth < 2; depth++) {
    const parent = await db.user.findUnique({
      where: { id: supervisorId },
      include: { enterpriseRoles: { include: { role: true } } },
    });
    if (
      !parent ||
      parent.organizationId !== actor.organizationId ||
      parent.accountStatus !== 'ACTIVE'
    )
      throw new ForbiddenException('Người ủy quyền không còn hoạt động');
    const parentAdmin = await db.scopedRoleGrant.findFirst({
      where: {
        userId: parent.id,
        organizationId: actor.organizationId,
        scope: 'ORGANIZATION',
        role: 'ORG_ADMIN',
        revokedAt: null,
      },
    });
    const parentPrimary =
      !!parentAdmin &&
      (parent.enterpriseTier === null || parent.enterpriseTier === 1);
    const inherited = parent.enterpriseRoles.filter(
      (r) =>
        r.role.permissions.includes(permission) &&
        (!chainId || r.chainIds.includes(chainId)) &&
        (!siteId || r.siteIds.includes(siteId)),
    );
    if (!parentPrimary && !inherited.length)
      throw new ForbiddenException('Quyền ủy quyền đã bị thu hồi');
    ancestry.push({
      id: parent.id,
      revision: parent.enterpriseRevision,
      admin: parentAdmin && {
        id: parentAdmin.id,
        revision: parentAdmin.revision,
      },
      roles: inherited.map((r) => ({ id: r.roleId, version: r.role.version })),
    });
    supervisorId = parentPrimary ? null : parent.supervisorId;
  }
  if (supervisorId) throw new ForbiddenException('Cấp ủy quyền không hợp lệ');
  const membership = chainId ? await db.chainMembership.findFirst({
      where: {
        chainId,
        organizationId: actor.organizationId,
        status: 'ACTIVE',
        chain: { businessProfile: { state: 'ACTIVE' } },
      },
    }) : null;
  if (chainId && !membership)
    throw new ForbiddenException(
      'Doanh nghiệp chưa tham gia chuỗi đang hoạt động',
    );
  const capabilities = await db.organizationCapability.findMany({where:{organizationId:actor.organizationId,revokedAt:null},orderBy:{code:'asc'}});
  if (permission.startsWith('materials.') && !capabilities.some(c=>c.code==='FARM')) throw new ForbiddenException('Tổ chức chưa có năng lực sản xuất');
  return {
    user,
    primary,
    matching,
    scope: canonicalSha256({
      user: user.id,
      organization: actor.organizationId,
      revision: user.enterpriseRevision,
      ancestry,
      capabilities: capabilities.map(c=>({code:c.code,revision:c.revision})),
      membership: membership && {id:membership.id,version:membership.version},
      admin: admin && { id: admin.id, revision: admin.revision },
      roles: matching
        .map((r) => ({
          id: r.roleId,
          version: r.role.version,
          chains: r.chainIds,
          sites: r.siteIds,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  };
}

export async function lockEnterprise(db: Prisma.TransactionClient, organizationId: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise:${organizationId}`},0))`;
}

/** Proposals belong to the level-1 owner; only the named member may accept or decline.
 * The acceptor scope excludes revision so a replay after acceptance stays valid. */
async function ownershipAuthority(db: Prisma.TransactionClient, input: AuthorizedCommand, lock: boolean) {
  const actor = input.actor!;
  const data = input.payload as Record<string, unknown>;
  if (['EW_OWNERSHIP_PROPOSE', 'EW_OWNERSHIP_CANCEL'].includes(input.operation)) {
    const auth = await enterpriseAuthority(db, actor, 'members.manage', undefined, undefined, lock);
    if (!auth.primary) throw new ForbiddenException('Chỉ quản trị cấp 1 được chuyển quyền chủ quản');
    return auth.scope;
  }
  if (lock) await lockEnterprise(db, actor.organizationId!);
  const transfer = await db.enterpriseOwnershipTransfer.findFirst({ where: { id: String(data.id), organizationId: actor.organizationId!, toUserId: actor.sub! } });
  const user = await db.user.findUnique({ where: { id: actor.sub! }, include: { organization: true } });
  if (!transfer || !user || user.accountStatus !== 'ACTIVE' || user.organizationId !== actor.organizationId || user.organization?.status !== 'ACTIVE')
    throw new ForbiddenException('Yêu cầu chuyển chủ quản không dành cho tài khoản này');
  return canonicalSha256({ user: user.id, organization: actor.organizationId, transfer: transfer.id });
}

/** Enrollment owners can correct a rejected registration before business activation. */
export async function profileAuthority(db:Prisma.TransactionClient,actor:CommandActor,lock=false) {
 if(!actor.organizationId||!actor.sub||['SYSTEM_ADMIN','AUDITOR','COMPLIANCE_REVIEWER','IOT_DEVICE'].includes(actor.role))throw new ForbiddenException();
 if(lock)await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise:${actor.organizationId}`},0))`;
 const user=await db.user.findUnique({where:{id:actor.sub},include:{organization:{include:{enterpriseEnrollment:true}}}});
 if(!user||user.accountStatus!=='ACTIVE'||user.organizationId!==actor.organizationId||user.organization?.status!=='ACTIVE')throw new ForbiddenException();
 if(user.organization.enterpriseEnrollment?.ownerId===actor.sub)return canonicalSha256({user:actor.sub,organization:actor.organizationId,enrollment:user.organization.enterpriseEnrollment.id});
 return (await enterpriseAuthority(db,actor,'profile.manage',undefined,undefined,lock)).scope;
}

const OPERATIONS: Record<string, EnterprisePermission> = {
  EW_PROFILE_CONTACT: 'profile.manage',
  EW_PROFILE_SUBMIT: 'profile.manage',
  EW_PROFILE_WITHDRAW: 'profile.manage',
  EW_OWNERSHIP_PROPOSE: 'members.manage',
  EW_OWNERSHIP_CANCEL: 'members.manage',
  EW_OWNERSHIP_ACCEPT: 'profile.read',
  EW_OWNERSHIP_DECLINE: 'profile.read',
  EW_CREATE_MEMBER: 'members.manage',
  EW_INVITE_MEMBER: 'members.manage',
  EW_REVOKE_MEMBER_INVITATION: 'members.manage',
  EW_UPDATE_MEMBER: 'members.manage',
  EW_CHANGE_MEMBER_SUPERVISOR: 'members.manage',
  EW_CREATE_ROLE: 'roles.manage',
  EW_UPDATE_ROLE: 'roles.manage',
  EW_INVITE_PARTNER: 'partners.manage',
  EW_CREATE_EXTERNAL_PARTNER: 'partners.manage',
  EW_RESOLVE_PARTNER: 'partners.manage',
  EW_CREATE_SITE: 'sites.manage',
  EW_COMPLETE_SITE: 'sites.manage',
  EW_UPDATE_SITE: 'sites.manage',
  EW_CREATE_VEHICLE: 'vehicles.manage',
  EW_UPDATE_VEHICLE: 'vehicles.manage',
  EW_CREATE_PRODUCT: 'catalog.manage',
  EW_UPDATE_PRODUCT: 'catalog.manage',
  EW_REVISE_SITE: 'sites.manage',
  EW_REVISE_VEHICLE: 'vehicles.manage',
  EW_IMPORT_PRODUCTS: 'catalog.manage',
  EW_CREATE_MATERIAL: 'materials.manage',
  EW_COMPLETE_MATERIAL: 'materials.manage',
  EW_UPDATE_MATERIAL: 'materials.manage',
  EW_UPLOAD_EVIDENCE: 'evidence.manage',
  EW_CREATE_FARM: 'catalog.manage',
  EW_COMPLETE_FARM: 'catalog.manage',
  EW_COMPLETE_PRODUCT: 'catalog.manage',
  EW_CREATE_PLOT: 'catalog.manage',
  EW_CREATE_CYCLE_DRAFT: 'production.write',
  EW_LINK_CYCLE_DRAFT: 'production.write',
  DIST_CREATE: 'distribution.write',
  DIST_CANCEL: 'distribution.write',
  DIST_SIGN: 'distribution.sign',
  DIST_OBSERVE: 'distribution.write',
  EW_TRACE_NOTICE: 'distribution.write',
  EW_CASE_ACK: 'cases.respond',
  EW_CASE_RESPOND: 'cases.respond',
  EW_DISPOSITION: 'quantity.adjust',
  EW_ALLOCATE: 'inventory.manage',
  EW_QUARANTINE: 'quarantine.manage',
  EW_SITE_TRANSFER_CREATE: 'inventory.manage',
  EW_MESSAGE_SEND: 'members.manage',
  EW_MESSAGE_REPLY: 'profile.read',
  EW_MESSAGE_READ: 'profile.read',
  EW_SITE_TRANSFER_DISPATCH: 'inventory.manage',
  EW_SITE_TRANSFER_RECEIVE: 'inventory.manage',
  EW_SITE_TRANSFER_RESOLVE: 'inventory.manage',
  EW_SITE_TRANSFER_CANCEL: 'inventory.manage',
  EW_QR_PRINT: 'qr.manage',
  DIST_RECEIPT: 'distribution.sign',
  DIST_C2_PREPARE: 'distribution.sign',
  DIST_C2_SUBMIT: 'distribution.sign',
  DIST_RENEW_CONSENT: 'distribution.write',
  DIST_RETURN: 'distribution.write',
  DIST_RETURN_SIGN: 'distribution.sign',
  EW_REGISTER_DISTRIBUTION_KEY: 'roles.manage',
  EW_REVOKE_DISTRIBUTION_KEY: 'roles.manage',
};
export async function authorizeWorkspaceCommand(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
  lock: boolean,
) {
  if (!input.actor?.organizationId || ['SYSTEM_ADMIN','PLATFORM_OPERATOR','PLATFORM_CASE_MANAGER','PLATFORM_PRIVACY_OFFICER','AUDITOR','COMPLIANCE_REVIEWER','IOT_DEVICE'].includes(input.actor.role)) throw new ForbiddenException('Chức năng ghi thuộc thành viên doanh nghiệp');
  const permission = OPERATIONS[input.operation];
  if (!permission)
    throw new ForbiddenException('Command doanh nghiệp chưa có policy');
  const data = input.payload as Record<string, unknown>;
  if (input.operation.startsWith('EW_PROFILE_')) return profileAuthority(db,input.actor!,lock);
  if (input.operation.startsWith('EW_OWNERSHIP_')) return ownershipAuthority(db, input, lock);
  if (input.operation === 'EW_UPLOAD_EVIDENCE') {
    if(data.entityType==='PROFILE'&&data.entityId===input.actor!.organizationId)return profileAuthority(db,input.actor!,lock);
    const context = await evidenceSubject(db,input.actor!,String(data.entityType),String(data.entityId),permission,typeof data.siteId==='string'?data.siteId:undefined);
    return (await enterpriseAuthority(db,input.actor!,permission,data.entityType==='CHAIN'?undefined:context.chainId,context.siteId,lock)).scope;
  }
  if (lock && input.operation === 'EW_LINK_CYCLE_DRAFT') {
    await lockChainScope(db, `org:${input.actor!.organizationId}`);
    if (typeof data.chainId === 'string') await lockChainScope(db, data.chainId);
  }
  if (lock && input.actor!.organizationId)
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise:${input.actor!.organizationId}`},0))`;
  const siteTransfer = input.operation.startsWith('EW_SITE_TRANSFER_') && input.operation !== 'EW_SITE_TRANSFER_CREATE'
    ? await db.siteTransfer.findUnique({ where: { id: String(data.id) } })
    : null;
  if (siteTransfer && siteTransfer.organizationId !== input.actor!.organizationId)
    throw new ForbiddenException('Phiếu chuyển nằm ngoài doanh nghiệp');
  if (input.operation.startsWith('EW_SITE_TRANSFER_') && input.operation !== 'EW_SITE_TRANSFER_CREATE' && !siteTransfer)
    throw new ForbiddenException('Không tìm thấy phiếu chuyển');
  let cycleDraftFarmId: string | undefined;
  if (input.operation === 'EW_LINK_CYCLE_DRAFT') {
    const draftId = String(data.id);
    const draft = await db.productionCycleDraft.findFirst({
      where: { id: draftId, organizationId: input.actor!.organizationId! },
      select: { farmId: true },
    });
    const linkedCycle = draft
      ? null
      : await db.productionCycle.findFirst({
          where: { id: draftId, farmOrgId: input.actor!.organizationId! },
          select: { farmId: true },
        });
    cycleDraftFarmId = draft?.farmId ?? linkedCycle?.farmId;
    if (!cycleDraftFarmId)
      throw new ForbiddenException('Vụ nháp nằm ngoài doanh nghiệp hoặc không còn tồn tại');
  }
  const lotOperations = ['EW_DISPOSITION', 'EW_TRACE_NOTICE', 'EW_ALLOCATE', 'EW_QUARANTINE', 'EW_QR_PRINT', 'EW_SITE_TRANSFER_CREATE', 'EW_SITE_TRANSFER_DISPATCH', 'EW_SITE_TRANSFER_RECEIVE', 'EW_SITE_TRANSFER_RESOLVE', 'EW_SITE_TRANSFER_CANCEL'];
  const producerMayAct = ['EW_ALLOCATE', 'EW_QR_PRINT'];
  const lot = lotOperations.includes(input.operation)
    ? await db.lot.findUnique({
        where: { id: String(siteTransfer?.lotId ?? data.lotId) },
        include: { harvest: { include: { cycle: true } } },
      })
    : null;
  if (
    lotOperations.includes(input.operation) &&
    (!lot ||
      (input.operation === 'EW_TRACE_NOTICE'
        ? lot.farmOrgId !== input.actor!.organizationId
        : !(producerMayAct.includes(input.operation) && lot.farmOrgId === input.actor!.organizationId) && !(await db.lotHolding.findUnique({
            where: {
              lotId_organizationId: {
                lotId: lot.id,
                organizationId: input.actor!.organizationId!,
              },
            },
          }))))
  )
    throw new ForbiddenException('Lô nằm ngoài phạm vi doanh nghiệp');
  if (['EW_CASE_ACK','EW_CASE_RESPOND'].includes(input.operation) && !await db.platformCase.findFirst({ where: { id: String(data.id), ownerOrganizationId: input.actor!.organizationId! } })) throw new ForbiddenException('Hồ sơ không còn được giao cho tổ chức');
  const transfer =
    input.operation.startsWith('DIST_') && input.operation !== 'DIST_CREATE'
      ? await db.distributionTransfer.findUnique({
          where: { id: String(data.id) },
        })
      : null;
  if (
    input.operation.startsWith('DIST_') &&
    input.operation !== 'DIST_CREATE' &&
    (!transfer ||
      ![transfer.senderId, transfer.receiverId, transfer.carrierId].includes(
        input.actor!.organizationId!,
      ))
  )
    throw new ForbiddenException('Giao nhận nằm ngoài doanh nghiệp');
  let siteId: string | undefined;
  if (transfer) {
    siteId =
      transfer.senderId === input.actor!.organizationId
        ? transfer.senderSiteId
        : transfer.carrierId === input.actor!.organizationId
          ? transfer.carrierSiteId
          : transfer.receiverSiteId;
  } else if (siteTransfer) {
    siteId =
      input.operation === 'EW_SITE_TRANSFER_RECEIVE'
        ? siteTransfer.toSiteId
        : siteTransfer.fromSiteId;
  } else if (
    input.operation === 'EW_SITE_TRANSFER_CREATE' &&
    typeof data.fromSiteId === 'string'
  ) {
    siteId = data.fromSiteId;
  } else if (typeof data.senderSiteId === 'string') {
    siteId = data.senderSiteId;
  } else if (typeof data.siteId === 'string') {
    siteId = data.siteId;
  } else if (
    ['EW_CREATE_PLOT', 'EW_CREATE_CYCLE_DRAFT'].includes(input.operation) &&
    typeof data.farmId === 'string'
  ) {
    siteId = data.farmId;
  } else if (
    input.operation === 'EW_CREATE_PRODUCT' &&
    typeof data.originFarmId === 'string'
  ) {
    siteId = data.originFarmId;
  } else if (input.operation === 'EW_LINK_CYCLE_DRAFT') {
    siteId = cycleDraftFarmId;
  } else if (['EW_REVISE_SITE', 'EW_UPDATE_SITE'].includes(input.operation)) {
    siteId = String(data.id);
  }
  const auth = await enterpriseAuthority(
    db,
    input.actor!,
    permission,
    transfer?.chainId ??
      lot?.harvest.cycle.chainId ??
      (typeof data.chainId === 'string' ? data.chainId : undefined),
    siteId ??
      (input.operation === 'EW_TRACE_NOTICE'
        ? lot?.harvest.cycle.farmId
        : undefined),
    lock,
  );
  if (input.operation.startsWith('DIST_') && !auth.primary && !siteId)
    throw new ForbiddenException(
      'Tài khoản nhân viên cần cơ sở được phân công trong giao nhận',
    );
  return auth.scope;
}

/** Custom grants narrow existing chain/assignment authority; they never replace it. */
export async function restrictEnterpriseBusiness(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
  lock: boolean,
  businessRole: string,
) {
  const user = await db.user.findUnique({
    where: { id: input.actor!.sub! },
    select: { enterpriseTier: true },
  });
  if (!user?.enterpriseTier || user.enterpriseTier === 1) return;
  const data = input.payload as Record<string, unknown>;
  let chainId = typeof data.chainId === 'string' ? data.chainId : undefined;
  let siteId: string | undefined;
  if (typeof data.cycleId === 'string') {
    const cycle = await db.productionCycle.findUnique({
      where: { id: data.cycleId },
    });
    chainId = cycle?.chainId;
    siteId = cycle?.farmId;
  }
  if (typeof data.id === 'string') {
    const cycle = await db.productionCycle.findUnique({
      where: { id: data.id },
    });
    if (cycle) {
      chainId = cycle.chainId;
      siteId = cycle.farmId;
    } else {
      const lot = await db.lot.findUnique({
        where: { id: data.id },
        include: { harvest: { include: { cycle: true } } },
      });
      if (lot) {
        chainId = lot.harvest.cycle.chainId;
        siteId = lot.harvest.cycle.farmId;
      }
    }
  }
  if (typeof data.farmId === 'string') siteId = data.farmId;
  if (typeof data.lotId === 'string') {
    const lot = await db.lot.findUnique({
      where: { id: data.lotId },
      include: { harvest: { include: { cycle: true } } },
    });
    chainId = lot?.harvest.cycle.chainId;
    siteId = lot?.harvest.cycle.farmId;
  }
  let shipmentId =
    typeof data.shipmentId === 'string' ? data.shipmentId : undefined;
  if (
    !shipmentId &&
    typeof data.id === 'string' &&
    /SHIPMENT/.test(input.operation)
  )
    shipmentId = data.id;
  if (typeof data.handoverId === 'string')
    shipmentId = (
      await db.shipmentHandover.findUnique({ where: { id: data.handoverId } })
    )?.shipmentId;
  if (typeof data.intentId === 'string') {
    const intent = await db.signingIntent.findUnique({
      where: { id: data.intentId },
    });
    if (intent?.entityType === 'SHIPMENT') shipmentId = intent.entityId;
  }
  if (shipmentId) {
    const shipment = await db.shipment.findUnique({
      where: { id: shipmentId },
      include: { lot: { include: { harvest: { include: { cycle: true } } } } },
    });
    chainId = shipment?.lot.harvest.cycle.chainId;
    siteId =
      businessRole === 'FARM_STAFF'
        ? shipment?.lot.harvest.cycle.farmId
        : undefined;
  }
  if (!chainId)
    throw new ForbiddenException(
      'Không xác định được phạm vi chuỗi của tài khoản nhân viên',
    );
  await enterpriseAuthority(
    db,
    input.actor!,
    businessRole === 'FARM_STAFF'
      ? 'production.write'
      : /HANDOVER|SIGNED_INTENT/.test(input.operation)
        ? 'distribution.sign'
        : 'distribution.write',
    chainId,
    siteId,
    lock,
  );
}
