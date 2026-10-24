import { assertEntitlement } from '../billing/billing-core.js';
import { assertSiteStaff } from '../catalog/product-refs.js';
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ENTERPRISE_ROLE_TEMPLATES, organizationCode, organizationIdFromCode } from './role-templates.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { queueAccountCredentials, temporaryCredential } from '../auth/account-credentials.js';
import { nextMemberCode } from './member-code.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  requestLedgerGrant,
  requestLedgerRevoke,
} from '../ledger/ledger-permissions.js';
import {
  ENTERPRISE_PERMISSIONS,
  enterpriseAuthority,
  enterpriseTransferWhere,
} from './enterprise-policy.js';
import type {
  EnterpriseMemberInput,
  EnterpriseMemberUpdate,
  MemberSupervisorInput,
  EnterpriseRoleInput,
  MemberRoleInput,
  EnterprisePartnerInput,
  EnterprisePartnerDecision,
  EnterpriseExternalPartnerInput,
  EnterpriseSiteInput,
  EnterpriseVehicleInput,
  ResourceStatusInput,
} from './dto.js';

const MEMBER_SELECT = {
  id: true,
  memberCode: true,
  fullName: true,
  email: true,
  phone: true,
  jobTitle: true,
  workSiteId: true,
  responsibleFarmId: true,
  contactAddress: true,
  memberNote: true,
  enterpriseTier: true,
  supervisorId: true,
  enterpriseRevision: true,
  accountStatus: true,
  enterpriseRoles: { include: { role: true } },
} as const;
@Injectable()
export class EnterpriseWorkspaceService {
  constructor(private readonly db: PrismaService) {}
  async validateMemberProfileReferences(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    profile: { workSiteId?: string | null; responsibleFarmId?: string | null },
  ) {
    if (profile.workSiteId) {
      await enterpriseAuthority(tx, actor, 'members.manage', undefined, profile.workSiteId);
      if (!await tx.enterpriseSite.findFirst({ where: { id: profile.workSiteId, organizationId: actor.organizationId!, status: 'ACTIVE' } }))
        throw new ConflictException('Cơ sở làm việc không thuộc doanh nghiệp hoặc chưa hoạt động');
    }
    if (profile.responsibleFarmId) {
      await enterpriseAuthority(tx, actor, 'members.manage', undefined, profile.responsibleFarmId);
      if (!await tx.farm.findFirst({ where: { id: profile.responsibleFarmId, organizationId: actor.organizationId!, status: 'ACTIVE', evidenceComplete: true } }))
        throw new ConflictException('Vùng phụ trách không thuộc doanh nghiệp hoặc chưa hoạt động');
    }
  }
  async overview(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'profile.read');
    const org = await this.db.organization.findUniqueOrThrow({
      where: { id: actor.organizationId! },
      include: {
        profile: true,
        capabilities: { where: { revokedAt: null } },
        enterpriseEnrollment: { select: { businessId: true, hostingMode: true } },
      },
    });
    const has = (permission: string) =>
      auth.primary ||
      auth.user.enterpriseRoles.some((r) =>
        r.role.permissions.includes(permission),
      );
    const [members, sites, products, transfers] = await Promise.all([
      has('members.read')
        ? this.db.user.count({
            where: {
              organizationId: org.id,
              ...(auth.primary ? {} : { supervisorId: actor.sub! }),
            },
          })
        : 0,
      has('sites.read')
        ? this.db.enterpriseSite.count({
            where: {
              organizationId: org.id,
              ...(auth.primary
                ? {}
                : {
                    id: {
                      in: auth.user.enterpriseRoles
                        .filter((r) =>
                          r.role.permissions.includes('sites.read'),
                        )
                        .flatMap((r) => r.siteIds),
                    },
                  }),
            },
          })
        : 0,
      has('catalog.read')
        ? this.db.product.count({ where: { organizationId: org.id } })
        : 0,
      has('distribution.read')
        ? this.db.distributionTransfer.count({
            where: enterpriseTransferWhere(actor, auth),
          })
        : 0,
    ]);
    return {
      organization: {
        id: org.id,
        code: organizationCode(org.id),
        name: org.name,
        type: org.type,
        status: org.status,
        capabilities: org.capabilities.map((c) => c.code),
        participationModel: org.participationModel,
        businessId: org.enterpriseEnrollment?.businessId ?? null,
        hostingMode: org.enterpriseEnrollment?.hostingMode ?? null,
      },
      profile: org.profile,
      member: {
        id: auth.user.id,
        tier: auth.user.enterpriseTier ?? 1,
        primary: auth.primary,
        enrollmentOwner:
          auth.user.organization?.enterpriseEnrollment?.ownerId === actor.sub,
      },
      permissions: auth.primary
        ? [...ENTERPRISE_PERMISSIONS]
        : [
            ...new Set(
              auth.user.enterpriseRoles.flatMap((r) => r.role.permissions),
            ),
          ],
      counts: { members, sites, products, transfers },
    };
  }
  async members(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'members.read');
    return {
      items: await this.db.user.findMany({
        where: {
          organizationId: actor.organizationId!,
          ...(!auth.primary ? { supervisorId: actor.sub! } : {}),
        },
        select: MEMBER_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
    };
  }
  async roleTemplates(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'roles.manage');
    const capabilities = await this.db.organizationCapability.findMany({ where: { organizationId: actor.organizationId!, revokedAt: null } });
    const granted = new Set(auth.user.enterpriseRoles.flatMap(r => r.role.permissions));
    return { items: ENTERPRISE_ROLE_TEMPLATES.filter(t => capabilities.some(c => c.code === t.capability)).map(t => ({ ...t, permissions: t.permissions.filter(p => auth.primary || granted.has(p)) })) };
  }
  async roles(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'members.read');
    const rows = await this.db.enterpriseRole.findMany({
      where: { organizationId: actor.organizationId! },
      orderBy: { name: 'asc' },
    });
    const owned = new Set(
      auth.user.enterpriseRoles.flatMap((r) => r.role.permissions),
    );
    return {
      items: rows.filter(
        (r) => auth.primary || r.permissions.every((p) => owned.has(p)),
      ),
    };
  }
  async validateDelegation(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    assignments: MemberRoleInput[],
  ) {
    const auth = await enterpriseAuthority(
      tx,
      actor,
      'members.manage',
      undefined,
      undefined,
      true,
    );
    for (const grant of assignments) {
      const role = await tx.enterpriseRole.findFirst({
        where: { id: grant.roleId, organizationId: actor.organizationId! },
      });
      if (!role) throw new ForbiddenException('Nhóm quyền ngoài doanh nghiệp');
      for (const permission of role.permissions) {
        if (
          !auth.primary &&
          !auth.user.enterpriseRoles.some(
            (r) =>
              r.role.permissions.includes(permission) &&
              grant.chainIds.every((c) => r.chainIds.includes(c)) &&
              grant.siteIds.every((s) => r.siteIds.includes(s)),
          )
        )
          throw new ForbiddenException(
            'Không được cấp quyền hoặc phạm vi vượt quyền đang có',
          );
      }
      for (const chainId of grant.chainIds)
        if (
          !(await tx.chainMembership.findFirst({
            where: {
              chainId,
              organizationId: actor.organizationId!,
              status: 'ACTIVE',
            },
          }))
        )
          throw new ForbiddenException('Chuỗi ngoài phạm vi doanh nghiệp');
      for (const id of grant.siteIds)
        if (
          !(await tx.enterpriseSite.findFirst({
            where: {
              id,
              organizationId: actor.organizationId!,
              status: 'ACTIVE',
            },
          })) &&
          !(await tx.farm.findFirst({
            where: {
              id,
              organizationId: actor.organizationId!,
              status: 'ACTIVE',
            },
          }))
        )
          throw new ForbiddenException('Cơ sở ngoài doanh nghiệp');
    }
    return auth;
  }
  async assign(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    userId: string,
    assignments: MemberRoleInput[],
  ) {
    await tx.enterpriseMemberRole.deleteMany({
      where: { userId, organizationId: actor.organizationId! },
    });
    for (const item of assignments)
      await tx.enterpriseMemberRole.create({
        data: { userId, organizationId: actor.organizationId!, ...item },
      });
    // Existing chain authorization and ledger epochs remain authoritative.
    const grants = await tx.scopedRoleGrant.findMany({
      where: { userId, scope: 'CHAIN', revokedAt: null },
    });
    for (const grant of grants) {
      await requestLedgerRevoke(tx, grant.id, 'NORMAL');
      await tx.scopedRoleGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
    }
    const roles = await tx.enterpriseRole.findMany({
      where: {
        id: { in: assignments.map((a) => a.roleId) },
        organizationId: actor.organizationId!,
      },
    });
    const caps = await tx.organizationCapability.findMany({
      where: { organizationId: actor.organizationId!, revokedAt: null },
    });
    for (const chainId of new Set(assignments.flatMap((a) => a.chainIds))) {
      const perms = assignments
        .filter((a) => a.chainIds.includes(chainId))
        .flatMap(
          (a) => roles.find((r) => r.id === a.roleId)?.permissions ?? [],
        );
      const businessRoles = new Set<
        'FARM_STAFF' | 'TRANSPORTER' | 'RETAILER' | 'DISTRIBUTOR' | 'PROCESSOR'
      >();
      if (
        perms.includes('production.write') &&
        caps.some((c) => c.code === 'FARM')
      )
        businessRoles.add('FARM_STAFF');
      if (perms.some((p) => p.startsWith('distribution.')))
        for (const c of caps) {
          if (c.code === 'DISTRIBUTOR') businessRoles.add('DISTRIBUTOR');
          if (c.code === 'PROCESSOR') businessRoles.add('PROCESSOR');
          if (c.code === 'TRANSPORTER') businessRoles.add('TRANSPORTER');
          if (c.code === 'RETAILER') businessRoles.add('RETAILER');
        }
      for (const role of businessRoles) {
        const grant = await tx.scopedRoleGrant.create({
          data: {
            userId,
            organizationId: actor.organizationId!,
            chainId,
            scope: 'CHAIN',
            role,
          },
        });
        await requestLedgerGrant(tx, grant);
      }
    }
  }
  async createMember(actor: CommandActor, input: EnterpriseMemberInput) {
    // The member never receives a password chosen by someone else: a
    // temporary one is mailed and must be replaced at first sign-in.
    const { password, passwordHash } = await temporaryCredential();
    return commandTransaction(this.db, async (tx) => {
      const auth = await this.validateDelegation(tx, actor, input.roles);
      await this.validateMemberProfileReferences(tx, actor, input);
      if (!auth.primary && input.tier !== 3)
        throw new ForbiddenException('Cấp 2 chỉ được tạo tài khoản cấp 3');
      const role = await tx.role.findUniqueOrThrow({
        where: { code: auth.user.roleId ? actor.role : 'RETAILER' },
      });
      await assertEntitlement(tx, actor.organizationId!, 'members');
      const user = await tx.user.create({
        data: {
          memberCode: await nextMemberCode(tx, actor.organizationId!),
          organizationId: actor.organizationId!,
          roleId: role.id,
          email: input.email.trim().toLowerCase(),
          fullName: input.fullName.trim(),
          jobTitle: input.jobTitle.trim(),
          phone: input.phone?.trim(),
          workSiteId: input.workSiteId,
          responsibleFarmId: input.responsibleFarmId,
          contactAddress: input.contactAddress?.trim(),
          memberNote: input.memberNote?.trim(),
          passwordHash,
          mustChangePassword: true,
          enterpriseTier: input.tier,
          supervisorId: actor.sub!,
        },
      });
      await this.assign(tx, actor, user.id, input.roles);
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId! },
        select: { name: true },
      });
      await queueAccountCredentials(
        tx,
        user,
        password,
        `Bạn đã được thêm làm thành viên của ${organization.name} trên AgriTrace (mã nội bộ ${user.memberCode}).`,
      );
      return {
        record: await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: MEMBER_SELECT,
        }),
      };
    });
  }
  updateMember(actor: CommandActor, id: string, input: EnterpriseMemberUpdate) {
    return commandTransaction(this.db, async (tx) => {
      const auth = await this.validateDelegation(tx, actor, input.roles);
      await this.validateMemberProfileReferences(tx, actor, input);
      const member = await tx.user.findFirst({
        where: { id, organizationId: actor.organizationId! },
      });
      if (
        !member ||
        id === actor.sub ||
        member.enterpriseTier === 1 ||
        member.enterpriseTier === null ||
        (!auth.primary && member.supervisorId !== actor.sub)
      )
        throw new ForbiddenException('Không thể sửa tài khoản này');
      const changed = await tx.user.updateMany({
        where: { id, enterpriseRevision: input.version },
        data: {
          accountStatus: input.status,
          jobTitle: input.jobTitle?.trim(),
          phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
          workSiteId: input.workSiteId,
          responsibleFarmId: input.responsibleFarmId,
          contactAddress: input.contactAddress === undefined ? undefined : input.contactAddress?.trim() || null,
          memberNote: input.memberNote === undefined ? undefined : input.memberNote?.trim() || null,
          enterpriseRevision: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('Quyền đã thay đổi; tải lại thành viên');
      await this.assign(
        tx,
        actor,
        id,
        input.status === 'ACTIVE' ? input.roles : [],
      );
      const descendants = await tx.user.findMany({
        where: { supervisorId: id, organizationId: actor.organizationId! },
      });
      for (const child of descendants) {
        await this.assign(tx, actor, child.id, []);
        await tx.user.update({
          where: { id: child.id },
          data: {
            accountStatus: 'LOCKED',
            enterpriseRevision: { increment: 1 },
          },
        });
        await tx.refreshSession.updateMany({
          where: { userId: child.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.refreshSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return {
        record: await tx.user.findUniqueOrThrow({
          where: { id },
          select: MEMBER_SELECT,
        }),
      };
    });
  }
  /** The owner moves a member under another manager. The supervisor bounds
   * what the member may do (enterpriseAuthority walks it) and who manages the
   * member, so the new manager must already hold every permission and scope
   * the member's roles grant; tier 2 stays directly under the owner. */
  changeSupervisor(actor: CommandActor, id: string, input: MemberSupervisorInput) {
    return commandTransaction(this.db, async (tx) => {
      const auth = await enterpriseAuthority(tx, actor, 'members.manage', undefined, undefined, true);
      if (!auth.primary)
        throw new ForbiddenException('Chỉ chủ quản doanh nghiệp đổi người quản lý trực tiếp');
      const member = await tx.user.findFirst({
        where: { id, organizationId: actor.organizationId! },
        include: { enterpriseRoles: { include: { role: true } } },
      });
      if (!member || id === actor.sub || !member.enterpriseTier || member.enterpriseTier === 1)
        throw new ForbiddenException('Không thể đổi người quản lý của tài khoản này');
      let supervisorId: string = actor.sub!;
      if (input.supervisorId && input.supervisorId !== actor.sub) {
        if (member.enterpriseTier !== 3)
          throw new UnprocessableEntityException('Quản lý cấp 2 chỉ trực thuộc chủ quản doanh nghiệp');
        const manager = await tx.user.findFirst({
          where: { id: input.supervisorId, organizationId: actor.organizationId!, accountStatus: 'ACTIVE', enterpriseTier: 2 },
          include: { enterpriseRoles: { include: { role: true } } },
        });
        if (!manager || manager.id === id)
          throw new UnprocessableEntityException('Người quản lý mới phải là quản lý cấp 2 đang hoạt động');
        const parentAdmin = manager.supervisorId
          ? await tx.scopedRoleGrant.findFirst({ where: { userId: manager.supervisorId, organizationId: actor.organizationId!, scope: 'ORGANIZATION', role: 'ORG_ADMIN', revokedAt: null } })
          : null;
        if (manager.supervisorId && !parentAdmin)
          throw new UnprocessableEntityException('Quản lý cấp 2 này không trực thuộc chủ quản');
        const missing = new Set<string>();
        for (const granted of member.enterpriseRoles)
          for (const permission of granted.role.permissions)
            if (!manager.enterpriseRoles.some((held) =>
              held.role.permissions.includes(permission) &&
              granted.chainIds.every((c) => held.chainIds.includes(c)) &&
              granted.siteIds.every((site) => held.siteIds.includes(site))))
              missing.add(permission);
        if (missing.size)
          throw new ConflictException(`Người quản lý mới chưa có đủ quyền/phạm vi của thành viên: ${[...missing].join(', ')}`);
        supervisorId = manager.id;
      }
      if (member.enterpriseRevision !== input.version)
        throw new ConflictException('Thành viên đã thay đổi; tải lại rồi thử lại');
      if (member.supervisorId === supervisorId)
        throw new ConflictException('Thành viên đã thuộc người quản lý này');
      // The hierarchy guard accepts the update only next to this record.
      await tx.enterpriseSupervisorChange.create({
        data: {
          organizationId: actor.organizationId!,
          memberId: id,
          fromSupervisorId: member.supervisorId,
          toSupervisorId: supervisorId,
          actorId: actor.sub!,
        },
      });
      const changed = await tx.user.updateMany({
        where: { id, enterpriseRevision: input.version },
        data: { supervisorId, enterpriseRevision: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException('Thành viên đã thay đổi; tải lại rồi thử lại');
      // Permissions now resolve through a different chain: sign in again.
      await tx.refreshSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return {
        record: await tx.user.findUniqueOrThrow({ where: { id }, select: MEMBER_SELECT }),
      };
    });
  }
  /** Removes a role nobody holds and no pending invitation grants. */
  deleteRole(actor: CommandActor, id: string, version: number) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'roles.manage', undefined, undefined, true);
      const role = await tx.enterpriseRole.findFirst({
        where: { id, organizationId: actor.organizationId! },
        include: { members: true },
      });
      if (!role) throw new NotFoundException('Không tìm thấy nhóm quyền');
      if (role.version !== version)
        throw new ConflictException('Nhóm quyền đã thay đổi; tải lại trang');
      if (role.members.length)
        throw new ConflictException(
          'Nhóm đang gán cho thành viên; chuyển các thành viên sang nhóm khác trước khi xóa',
        );
      const invitations = await tx.enterpriseInvitation.findMany({
        where: { organizationId: actor.organizationId!, status: 'PENDING' },
        select: { roles: true },
      });
      if (
        invitations.some((i) =>
          (i.roles as { roleId?: string }[]).some((r) => r.roleId === id),
        )
      )
        throw new ConflictException(
          'Nhóm đang nằm trong lời mời chưa kết thúc; thu hồi lời mời trước khi xóa',
        );
      await tx.enterpriseRole.delete({ where: { id } });
      return { record: { id, deleted: true } };
    });
  }
  saveRole(actor: CommandActor, input: EnterpriseRoleInput, id?: string) {
    return commandTransaction(this.db, async (tx) => {
      const auth = await enterpriseAuthority(
        tx,
        actor,
        'roles.manage',
        undefined,
        undefined,
        true,
      );
      const owned = new Set(
        auth.user.enterpriseRoles.flatMap((r) => r.role.permissions),
      );
      const permissions = new Set(['profile.read', ...input.permissions]);
      const dependencies: Record<string, string[]> = {
        'members.manage': ['members.read'],
        'roles.manage': ['members.read'],
        'partners.manage': ['partners.read'],
        'catalog.manage': ['catalog.read'],
        'sites.manage': ['sites.read'],
        'vehicles.manage': ['vehicles.read'],
        'production.write': ['production.read'],
        'distribution.write': [
          'distribution.read',
          'reports.read',
          'partners.read',
        ],
        'distribution.sign': ['distribution.read'],
        'cases.respond': ['cases.read'],
        'evidence.manage': ['evidence.read'],
        'materials.manage': ['materials.read'],
        'inventory.manage': ['reports.read','sites.read'],
        'quarantine.manage': ['reports.read','sites.read'],
        'quantity.adjust': ['reports.read'],
      };
      for (const permission of permissions)
        for (const dependency of dependencies[permission] ?? [])
          permissions.add(dependency);
      if (!auth.primary && [...permissions].some((p) => !owned.has(p)))
        throw new ForbiddenException('Nhóm quyền vượt quyền đang có');
      if (id) {
        const role = await tx.enterpriseRole.findFirst({
          where: { id, organizationId: actor.organizationId! },
          include: { members: true },
        });
        if (!role) throw new NotFoundException('Không tìm thấy nhóm quyền');
        // Editing an assigned role changes every holder at once. A manager may
        // only do that when every holder is someone they manage.
        if (!auth.primary && role.members.length) {
          const holders = await tx.user.findMany({
            where: { id: { in: role.members.map((m) => m.userId) } },
            select: { id: true, supervisorId: true },
          });
          if (holders.some((h) => h.supervisorId !== actor.sub))
            throw new ForbiddenException(
              'Nhóm đang gán cho thành viên ngoài phạm vi bạn quản lý',
            );
        }
        const changed = await tx.enterpriseRole.updateMany({
          where: { id, version: input.version ?? -1 },
          data: {
            name: input.name.trim(),
            permissions: [...permissions],
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ConflictException('Nhóm quyền đã thay đổi');
        // Chain grants are derived from role permissions; rebuild them for
        // every active holder. Sessions stay, permissions are read per request.
        const holderIds = [...new Set(role.members.map((m) => m.userId))];
        const active = await tx.user.findMany({
          where: { id: { in: holderIds }, accountStatus: 'ACTIVE' },
          select: { id: true },
        });
        for (const holder of active) {
          const grants = await tx.enterpriseMemberRole.findMany({
            where: { userId: holder.id, organizationId: actor.organizationId! },
            select: { roleId: true, chainIds: true, siteIds: true },
          });
          await this.assign(tx, actor, holder.id, grants);
          await tx.user.update({
            where: { id: holder.id },
            data: { enterpriseRevision: { increment: 1 } },
          });
        }
        return {
          record: await tx.enterpriseRole.findUniqueOrThrow({ where: { id } }),
          affectedMembers: active.length,
        };
      }
      return {
        record: await tx.enterpriseRole.create({
          data: {
            organizationId: actor.organizationId!,
            name: input.name.trim(),
            permissions: [...permissions],
          },
        }),
      };
    });
  }
  async partners(actor: CommandActor) {
    await enterpriseAuthority(this.db, actor, 'partners.read');
    const rows = await this.db.enterprisePartner.findMany({
      where: {
        OR: [
          { inviterId: actor.organizationId! },
          { inviteeId: actor.organizationId! },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const orgs = await this.db.organization.findMany({
      where: { id: { in: rows.flatMap((r) => [r.inviterId, r.inviteeId]) } },
      select: { id: true, name: true, type: true },
    });
    return {
      items: rows.map((r) => ({
        ...r,
        inviter: orgs.find((o) => o.id === r.inviterId) && { ...orgs.find((o) => o.id === r.inviterId), code: organizationCode(r.inviterId) },
        invitee: orgs.find((o) => o.id === r.inviteeId) && { ...orgs.find((o) => o.id === r.inviteeId), code: organizationCode(r.inviteeId) },
      })),
    };
  }
  async externalPartners(actor: CommandActor) {
    await enterpriseAuthority(this.db, actor, 'partners.read');
    return { items: await this.db.enterpriseExternalPartner.findMany({
      where: { organizationId: actor.organizationId! },
      orderBy: { createdAt: 'desc' }, take: 500,
    }) };
  }
  async searchPartners(actor: CommandActor, query: string) {
    await enterpriseAuthority(this.db, actor, 'partners.read');
    const q = query.trim();
    if (q.length < 2 || q.length > 80) return { items: [] };
    // An AgriTrace code is AGT- plus the organization UUID without dashes.
    const codePart = q.replace(/^AGT-?/i, '').replace(/[^A-Fa-f0-9]/g, '').toLowerCase();
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const [registered, external] = await Promise.all([
      this.db.$queryRaw<{ organizationId: string; businessId: string | null; name: string; type: string }[]>`
        SELECT e.organization_id AS "organizationId", e.business_id AS "businessId", o.name, o.type::text AS type
          FROM enterprise_enrollment e JOIN organization o ON o.organization_id = e.organization_id
         WHERE e.status = 'APPROVED' AND e.organization_id <> ${actor.organizationId!}::uuid
           AND (e.business_id ILIKE ${like} OR o.name ILIKE ${like}
             OR (${codePart.length >= 4} AND replace(e.organization_id::text, '-', '') LIKE ${`%${codePart}%`}))
         ORDER BY o.name LIMIT 20`,
      this.db.enterpriseExternalPartner.findMany({
        where: { organizationId: actor.organizationId!, OR: [
          { businessId: { contains: q, mode: 'insensitive' } },
          { taxCode: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ] },
        take: 20,
      }),
    ]);
    const lower = q.toLowerCase();
    const matched = (tax: string | null, name: string, code: string | null) =>
      tax && tax.toLowerCase().includes(lower) ? 'TAX' : name.toLowerCase().includes(lower) ? 'NAME' : code ? 'CODE' : 'TAX';
    return { items: [
      ...registered.map((row) => {
        const code = organizationCode(row.organizationId);
        return { id: row.organizationId, businessId: row.businessId ?? code, taxCode: row.businessId, agriTraceCode: code, name: row.name, kind: row.type, registered: true, matched: matched(row.businessId, row.name, code) };
      }),
      ...external.map((row) => ({ id: row.id, businessId: row.businessId, taxCode: row.taxCode ?? row.businessId, agriTraceCode: null, name: row.name, kind: row.kind, registered: false, matched: matched(row.taxCode ?? row.businessId, row.name, null) })),
    ] };
  }
  /** Business profile of another approved enterprise, for deciding whether
   * to invite it. Only approved enterprises are listed; no member data. */
  async partnerProfile(actor: CommandActor, organizationId: string) {
    await enterpriseAuthority(this.db, actor, 'partners.read');
    if (organizationId === actor.organizationId)
      throw new NotFoundException('Không tìm thấy doanh nghiệp');
    const enrollment = await this.db.enterpriseEnrollment.findFirst({
      where: { organizationId, status: 'APPROVED' },
      select: { businessId: true, organization: { select: { name: true, type: true } } },
    });
    if (!enrollment) throw new NotFoundException('Không tìm thấy doanh nghiệp');
    const [profile, capabilities, link] = await Promise.all([
      this.db.enterpriseProfile.findUnique({ where: { organizationId } }),
      this.db.organizationCapability.findMany({
        where: { organizationId, revokedAt: null },
        select: { code: true },
      }),
      this.db.enterprisePartner.findFirst({
        where: {
          OR: [
            { inviterId: actor.organizationId!, inviteeId: organizationId },
            { inviterId: organizationId, inviteeId: actor.organizationId! },
          ],
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      organizationId,
      agriTraceCode: organizationCode(organizationId),
      name: enrollment.organization.name,
      kind: enrollment.organization.type,
      taxCode: enrollment.businessId,
      capabilities: capabilities.map((c) => c.code),
      legalForm: profile?.legalForm ?? null,
      address: profile?.address ?? null,
      ward: profile?.ward ?? null,
      province: profile?.province ?? null,
      representative: profile?.representative ?? null,
      phone: profile?.phone ?? null,
      contactEmail: profile?.contactEmail ?? null,
      website: profile?.website ?? null,
      description: profile?.description ?? null,
      activities: profile?.activities ?? [],
      linkStatus: link?.status ?? null,
      linkDirection: link ? (link.inviterId === actor.organizationId ? 'SENT' : 'RECEIVED') : null,
    };
  }
  createExternalPartner(actor: CommandActor, input: EnterpriseExternalPartnerInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'partners.manage', undefined, undefined, true);
      const businessId = input.businessId.trim().toUpperCase();
      if (await tx.enterpriseEnrollment.findFirst({ where: { businessId, status: 'APPROVED' } }))
        throw new ConflictException('Mã này đã thuộc doanh nghiệp AgriTrace; dùng lời mời liên kết');
      return { record: await tx.enterpriseExternalPartner.create({ data: {
        organizationId: actor.organizationId!, businessId, name: input.name.trim(), kind: input.kind,
        address: input.address.trim(), phone: input.phone?.trim(), email: input.email?.trim().toLowerCase(),
        taxCode: input.taxCode?.trim(), representative: input.representative?.trim(), note: input.note?.trim(),
      } }) };
    });
  }
  invitePartner(actor: CommandActor, input: EnterprisePartnerInput) {
    return commandTransaction(this.db, async (tx) => {
      const organizationId = organizationIdFromCode(input.businessId);
      const target = await tx.enterpriseEnrollment.findUnique({
        where: organizationId ? { organizationId } : { businessId: input.businessId },
      });
      if (
        !target ||
        target.status !== 'APPROVED' ||
        target.organizationId === actor.organizationId
      )
        throw new ConflictException(
          'Cần mã doanh nghiệp đối tác đã được duyệt',
        );
      const exists = await tx.enterprisePartner.findFirst({
        where: {
          OR: [
            {
              inviterId: actor.organizationId!,
              inviteeId: target.organizationId,
            },
            {
              inviteeId: actor.organizationId!,
              inviterId: target.organizationId,
            },
          ],
        },
      });
      if (exists && ['REJECTED', 'REVOKED'].includes(exists.status))
        return {
          record: await tx.enterprisePartner.update({
            where: { id: exists.id },
            data: {
              inviterId: actor.organizationId!,
              inviteeId: target.organizationId,
              status: 'INVITED',
              version: { increment: 1 },
              note: input.note,
            },
          }),
        };
      if (exists)
        throw new ConflictException(
          'Hai doanh nghiệp đã có lời mời hoặc quan hệ; xử lý quan hệ hiện tại',
        );
      return {
        record: await tx.enterprisePartner.create({
          data: {
            inviterId: actor.organizationId!,
            inviteeId: target.organizationId,
            note: input.note,
          },
        }),
      };
    });
  }
  resolvePartner(
    actor: CommandActor,
    id: string,
    input: EnterprisePartnerDecision,
  ) {
    return commandTransaction(this.db, async (tx) => {
      const row = await tx.enterprisePartner.findUnique({ where: { id } });
      if (
        !row ||
        ![row.inviteeId, row.inviterId].includes(actor.organizationId!)
      )
        throw new NotFoundException();
      if (
        input.decision !== 'REVOKE' &&
        (row.inviteeId !== actor.organizationId || row.status !== 'INVITED')
      )
        throw new ForbiddenException('Chỉ doanh nghiệp được mời được phản hồi');
      if (
        input.decision === 'REVOKE' &&
        !['ACTIVE', 'INVITED'].includes(row.status)
      )
        throw new ConflictException('Quan hệ đã kết thúc');
      const changed = await tx.enterprisePartner.updateMany({
        where: { id, version: input.version },
        data: {
          status:
            input.decision === 'ACCEPT'
              ? 'ACTIVE'
              : input.decision === 'REJECT'
                ? 'REJECTED'
                : 'REVOKED',
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('Quan hệ đã thay đổi');
      return {
        record: await tx.enterprisePartner.findUniqueOrThrow({ where: { id } }),
      };
    });
  }
  async sites(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'sites.read');
    return {
      items: await this.db.enterpriseSite.findMany({
        where: {
          organizationId: actor.organizationId!,
          ...(auth.primary
            ? {}
            : { id: { in: auth.matching.flatMap((r) => r.siteIds) } }),
        },
        orderBy: { name: 'asc' },
      }),
    };
  }
  async vehicles(actor: CommandActor) {
    await enterpriseAuthority(this.db, actor, 'vehicles.read');
    return {
      items: await this.db.enterpriseVehicle.findMany({
        where: { organizationId: actor.organizationId! },
        orderBy: { registration: 'asc' },
      }),
    };
  }
  createSite(actor: CommandActor, input: EnterpriseSiteInput) {
    return commandTransaction(this.db, async (tx) => {
      const auth=await enterpriseAuthority(tx,actor,'sites.manage',undefined,undefined,true);
      if(!auth.primary)throw new ForbiddenException('Chủ quản tạo cơ sở mới trước khi ủy quyền phạm vi');
      if(input.farmId && !await tx.farm.findFirst({where:{id:input.farmId,organizationId:actor.organizationId!,status:'ACTIVE',evidenceComplete:true}}))throw new ConflictException('Vùng liên kết chưa hoàn tất hoặc ngoài doanh nghiệp');
      await assertSiteStaff(tx,actor.organizationId!,input.staffUserId);
      return ({
      record: await tx.enterpriseSite.create({
        data: { organizationId: actor.organizationId!, ...input, status:'INACTIVE',evidenceComplete:false },
      }),
    });});
  }
  createVehicle(actor: CommandActor, input: EnterpriseVehicleInput) {
    return commandTransaction(this.db, async (tx) => ({
      record: await tx.enterpriseVehicle.create({
        data: { organizationId: actor.organizationId!, ...input },
      }),
    }));
  }
  status(
    actor: CommandActor,
    kind: 'site' | 'vehicle',
    id: string,
    input: ResourceStatusInput,
  ) {
    return commandTransaction(this.db, async (tx) => {
      if(kind==='site' && input.status==='ACTIVE' && await tx.enterpriseSite.findFirst({where:{id,organizationId:actor.organizationId!,evidenceComplete:false}}))throw new ConflictException('Cần ảnh cơ sở trước khi kích hoạt');
      if(input.status==='INACTIVE' && (kind==='site'?await tx.lotSiteHolding.count({where:{siteId:id,quantity:{gt:0}}}):await tx.distributionTransfer.count({where:{vehicleId:id,status:{in:['PROPOSED','READY','IN_TRANSIT']}}})))throw new ConflictException('Đối soát tồn hoặc chặng đang mở trước khi ngừng sử dụng');
      const args = {
        where: {
          id,
          organizationId: actor.organizationId!,
          version: input.version,
        },
        data: { status: input.status, version: { increment: 1 } },
      };
      const changed =
        kind === 'site'
          ? await tx.enterpriseSite.updateMany(args)
          : await tx.enterpriseVehicle.updateMany(args);
      if (changed.count !== 1)
        throw new ConflictException(
          'Dữ liệu đã thay đổi hoặc ngoài doanh nghiệp',
        );
      return {
        record: { id, status: input.status, version: input.version + 1 },
      };
    });
  }
}
