import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import {
  BUSINESS_CAPABILITIES,
  chainAccess,
  organizationGrant,
} from './chain-policy.js';
import type { ChangeMemberDto, CreateChainDto, GrantRoleDto } from './dto.js';
import { normalizeExpiryDate } from '../../common/expiry-date.js';
import { assertBusinessActivationReady } from './business-profile.commands.js';
import { bindingObservation } from '../ledger/binding-observation.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from '../platform-governance/platform-audit.js';
import {
  APPROVAL_REQUIRED_MESSAGE,
  approvalsMode,
} from '../platform-governance/platform-config.js';
import {
  requestLedgerGrant,
  requestLedgerRevoke,
} from '../ledger/ledger-permissions.js';

@Injectable()
export class SupplyChainsService {
  constructor(private readonly prisma: PrismaService) {}

  async users(actor: CommandActor, organizationId: string) {
    await this.organizationAdmin(actor, organizationId);
    return this.prisma.user.findMany({
      where: { organizationId, accountStatus: 'ACTIVE' },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
      take: 200,
    });
  }

  async grants(actor: CommandActor, organizationId: string) {
    await this.organizationAdmin(actor, organizationId);
    return this.prisma.scopedRoleGrant.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  private async organizationAdmin(actor: CommandActor, organizationId: string) {
    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      (actor.organizationId !== organizationId ||
        !(await organizationGrant(this.prisma, actor, 'ORG_ADMIN')))
    )
      throw new NotFoundException('Không tìm thấy tổ chức');
  }

  async context(actor: CommandActor) {
    const organizationId =
      actor.organizationId ?? '00000000-0000-0000-0000-000000000000';
    const grants = await this.prisma.scopedRoleGrant.findMany({
      where: { userId: actor.sub!, organizationId, revokedAt: null },
    });
    const admin = grants.some(
      (g) => g.scope === 'ORGANIZATION' && g.role === 'ORG_ADMIN',
    );
    const memberships = await this.prisma.chainMembership.findMany({
      where: {
        organizationId,
        ...(admin
          ? {}
          : {
              status: 'ACTIVE',
              chainId: {
                in: grants.flatMap((g) => (g.chainId ? [g.chainId] : [])),
              },
            }),
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const capabilities = await this.prisma.organizationCapability.findMany({
      where: { organizationId, revokedAt: null },
    });
    const productionChains =
      actor.role === 'SYSTEM_ADMIN' ||
      !capabilities.some((c) => c.code === 'FARM')
        ? []
        : await this.prisma.supplyChain.findMany({
            where: {
              businessProfile: { is: { state: 'ACTIVE', scopeVersion: 1 } },
              memberships: { some: { organizationId, status: 'ACTIVE' } },
              grants: {
                some: {
                  userId: actor.sub!,
                  organizationId,
                  scope: 'CHAIN',
                  role: 'FARM_STAFF',
                  revokedAt: null,
                },
              },
            },
            orderBy: { name: 'asc' },
            take: 200,
          });
    const businessChains = await this.prisma.chainBusinessProfile.findMany({
      where: {
        state: 'ACTIVE',
        chainId: {
          in: memberships
            .filter((m) => m.status === 'ACTIVE')
            .map((m) => m.chainId),
        },
      },
      select: { chainId: true, version: true },
    });
    const [assignments, reviewAssignments] = await Promise.all([
      this.prisma.stageAssignment.findMany({
        where: {
          organizationId,
          chainId: { in: memberships.map((member) => member.chainId) },
        },
        select: {
          id: true,
          chainId: true,
          stage: true,
          status: true,
          version: true,
        },
        orderBy: { id: 'asc' },
        take: 10001,
      }),
      this.prisma.complianceAssignment.findMany({
        where: { reviewerUserId: actor.sub!, revokedAt: null },
        select: { id: true, farmId: true },
        orderBy: { id: 'asc' },
        take: 10001,
      }),
    ]);
    if (assignments.length > 10000 || reviewAssignments.length > 10000)
      throw new ConflictException(
        'Permission context cần phân trang trước khi mở rộng',
      );
    // UI invalidation only. Never use this complete role set as command/replay
    // authority: business fingerprints bind only the command's actual grant.
    const accessRevision = canonicalSha256({
      enterprise: await this.prisma.user.findUnique({
        where: { id: actor.sub! },
        select: {
          enterpriseRevision: true,
          enterpriseRoles: {
            select: {
              roleId: true,
              chainIds: true,
              siteIds: true,
              role: { select: { version: true } },
            },
          },
        },
      }),
      grants: grants.map((grant) => [grant.id, grant.revision]).sort(),
      memberships: memberships
        .map((member) => [member.id, member.status, member.version])
        .sort(),
      capabilities: capabilities
        .map((capability) => [capability.code, capability.revision])
        .sort(),
      profiles: businessChains
        .map((profile) => [profile.chainId, profile.version])
        .sort(),
      assignments,
      reviewAssignments,
    });
    return {
      accessRevision,
      grants,
      memberships,
      capabilities,
      productionChains,
      businessChains: businessChains.map((p) => p.chainId),
    };
  }

  async list(actor: CommandActor) {
    if (actor.role === 'SYSTEM_ADMIN')
      return this.prisma.supplyChain.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    const context = await this.context(actor);
    return this.prisma.supplyChain.findMany({
      where: { id: { in: context.memberships.map((m) => m.chainId) } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async get(actor: CommandActor, id: string) {
    if (actor.role === 'SYSTEM_ADMIN') {
      const chain = await this.prisma.supplyChain.findUnique({ where: { id } });
      if (!chain) throw new NotFoundException('Không tìm thấy chuỗi');
      return chain;
    }
    return (await chainAccess(this.prisma, actor, id)).chain;
  }
  /** Read-only ledger projection for any current chain member. */
  async ledgerStatus(actor: CommandActor, chainId: string) {
    await this.get(actor, chainId); // same visibility rule as the chain itself
    const profile = await this.prisma.chainLedgerProfile.findUnique({
      where: { chainId },
      include: { activeBinding: { include: { state: true } } },
    });
    const binding = profile?.activeBinding ?? null;
    const empty = {
      permissions: { active: 0, pending: 0, revoking: 0, held: 0 },
      delivery: {
        completed: 0,
        pending: 0,
        retry: 0,
        deadLetter: 0,
        oldestPendingAt: null,
        pendingAgeSeconds: null,
      },
    };
    if (!binding)
      return {
        chainId,
        profile: 'RELEASE_A',
        bindingStatus: null,
        channelId: null,
        ...empty,
        openHolds: 0,
        pendingControlJobs: 0,
        failedControlJobs: 0,
        lastControlFailureAt: null,
        worker: bindingObservation(null),
      };
    const [
      syncs,
      outbox,
      oldest,
      holds,
      jobs,
      failedJobs,
      lastFailure,
      observation,
    ] = await Promise.all([
      this.prisma.ledgerPermissionSync.groupBy({
        by: ['state'],
        where: { permission: { bindingDigest: binding.digest } },
        _count: true,
      }),
      this.prisma.blockchainOutbox.groupBy({
        by: ['status'],
        where: {
          traceEvent: {
            ledgerRoute: { definition: { bindingDigest: binding.digest } },
          },
        },
        _count: true,
      }),
      this.prisma.blockchainOutbox.findFirst({
        where: {
          status: { in: ['PENDING', 'RETRY', 'PROCESSING'] },
          traceEvent: {
            ledgerRoute: { definition: { bindingDigest: binding.digest } },
          },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.deliveryHold.count({
        where: { bindingDigest: binding.digest, resolvedAt: null },
      }),
      this.prisma.ledgerControlJob.count({
        where: {
          bindingDigest: binding.digest,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
      }),
      this.prisma.ledgerControlJob.count({
        where: { bindingDigest: binding.digest, status: 'FAILED' },
      }),
      this.prisma.ledgerControlJob.findFirst({
        where: { bindingDigest: binding.digest, status: 'FAILED' },
        select: { updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.bindingWorkerHealth.findUnique({
        where: { bindingDigest: binding.digest },
      }),
    ]);
    const count = (
      rows: Array<{ _count: number; state?: string; status?: string }>,
      ...names: string[]
    ) =>
      rows
        .filter((row) => names.includes(String(row.state ?? row.status)))
        .reduce((sum, row) => sum + row._count, 0);
    return {
      chainId,
      profile: binding.profile,
      bindingStatus: binding.state?.status ?? null,
      channelId: binding.channelId,
      permissions: {
        active: count(syncs, 'ACTIVE'),
        pending: count(syncs, 'REQUESTED', 'PENDING_LEDGER'),
        revoking: count(
          syncs,
          'REVOKE_REQUESTED',
          'DRAINING',
          'PENDING_REVOKE_LEDGER',
        ),
        held: count(
          syncs,
          'EMERGENCY_HOLD',
          'PENDING_EMERGENCY_REVOKE',
          'REVOKED_REVIEW_REQUIRED',
        ),
      },
      delivery: {
        completed: count(outbox, 'COMPLETED'),
        pending: count(outbox, 'PENDING', 'PROCESSING'),
        retry: count(outbox, 'RETRY'),
        deadLetter: count(outbox, 'DEAD_LETTER'),
        oldestPendingAt: oldest?.createdAt ?? null,
        pendingAgeSeconds: oldest
          ? Math.max(
              0,
              Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000),
            )
          : null,
      },
      openHolds: holds,
      pendingControlJobs: jobs,
      failedControlJobs: failedJobs,
      lastControlFailureAt: lastFailure?.updatedAt ?? null,
      worker: bindingObservation(observation),
    };
  }
  async members(actor: CommandActor, id: string) {
    if (actor.role === 'SYSTEM_ADMIN') {
      await this.get(actor, id);
      return this.prisma.chainMembership.findMany({
        where: { chainId: id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
    }
    const { chain, membership, grants } = await chainAccess(
      this.prisma,
      actor,
      id,
    );
    const manager =
      chain.ownerOrganizationId === actor.organizationId &&
      membership.status === 'ACTIVE' &&
      grants.some((g) => g.role === 'CHAIN_MANAGER');
    return this.prisma.chainMembership.findMany({
      where: {
        chainId: id,
        ...(manager ? {} : { organizationId: actor.organizationId! }),
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }
  create(actor: CommandActor, input: CreateChainDto) {
    return this.transaction(async (tx) => {
      const productIds = input.productIds ?? [];
      if (productIds.length && await tx.product.count({ where: { id: { in: productIds }, organizationId: actor.organizationId!, status: 'ACTIVE' } }) !== productIds.length)
        throw new UnprocessableEntityException('Sản phẩm liên kết phải là sản phẩm đang hoạt động của doanh nghiệp');
      const chain = await tx.supplyChain.create({
        data: {
          name: input.name,
          code: `CH-${randomUUID().slice(0, 12).toUpperCase()}`,
          chainType: input.chainType ?? 'CROP',
          description: input.description,
          plannedStartDate: input.plannedStartDate ? normalizeExpiryDate(input.plannedStartDate) : undefined,
          note: input.note,
          productIds,
          ownerOrganizationId: actor.organizationId!,
        },
      });
      await tx.chainBusinessProfile.create({ data: { chainId: chain.id } });
      await tx.chainMembership.create({
        data: {
          chainId: chain.id,
          organizationId: actor.organizationId!,
          status: 'ACTIVE',
        },
      });
      await tx.scopedRoleGrant.create({
        data: {
          chainId: chain.id,
          organizationId: actor.organizationId!,
          userId: actor.sub!,
          scope: 'CHAIN',
          role: 'CHAIN_MANAGER',
        },
      });
      await this.audit(tx, actor, 'CREATE_CHAIN', chain.id, 0, chain.id);
      return chain;
    });
  }
  async businessProfile(actor: CommandActor, chainId: string) {
    await chainAccess(this.prisma, actor, chainId);
    const profile = await this.prisma.chainBusinessProfile.findUnique({
      where: { chainId },
    });
    if (!profile)
      throw new NotFoundException('Chuỗi chưa chuẩn bị profile nghiệp vụ');
    return profile;
  }
  activateBusinessProfile(
    actor: CommandActor,
    chainId: string,
    version: number,
  ) {
    return this.transaction(async (tx) => {
      const profile = await tx.chainBusinessProfile.findUnique({
        where: { chainId },
      });
      if (
        !profile ||
        profile.state !== 'PREPARING' ||
        profile.version !== version
      )
        throw new ConflictException('Profile đã đổi hoặc không còn PREPARING');
      await assertBusinessActivationReady(tx, chainId);
      const activated = await tx.chainBusinessProfile.update({
        where: { chainId },
        data: { state: 'ACTIVE', version: { increment: 1 } },
      });
      await this.audit(
        tx,
        actor,
        'ACTIVATE_BUSINESS_PROFILE',
        chainId,
        activated.version,
        chainId,
      );
      return activated;
    });
  }
  suspendBusinessProfile(actor: CommandActor, chainId: string, version: number, reason: string) {
    return this.transaction(async (tx) => {
      // The command authority holds the chain scope lock. All business commands
      // acquire that lock before checking the profile, so this is a closed gate.
      const profile = await tx.chainBusinessProfile.findUnique({ where: { chainId } });
      if (!profile || profile.state !== 'ACTIVE' || profile.version !== version)
        throw new ConflictException('Trạng thái chuỗi đã đổi; tải lại trước khi ngừng');
      const [distribution, returns, remainder, shipments, plans, recalled] = await Promise.all([
        tx.distributionTransfer.count({ where: { chainId, status: { in: ['PROPOSED', 'READY', 'IN_TRANSIT'] } } }),
        tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM distribution_return r JOIN distribution_transfer t ON t.id = r.transfer_id WHERE t.chain_id = ${chainId}::uuid AND r.status = 'PROPOSED'`,
        tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM distribution_remainder r JOIN distribution_transfer t ON t.id = r.transfer_id WHERE t.chain_id = ${chainId}::uuid AND r.quantity > 0`,
        tx.shipment.count({ where: { lot: { harvest: { cycle: { chainId } } }, status: { in: ['CREATED', 'IN_TRANSIT', 'ARRIVED'] } } }),
        tx.shipmentPlan.count({ where: { chainId, status: { in: ['DRAFT', 'FINALIZED'] }, shipment: null } }),
        tx.lot.count({ where: { harvest: { cycle: { chainId } }, currentState: 'RECALLED' } }),
      ]);
      if (distribution || Number(returns[0]?.count ?? 0) || Number(remainder[0]?.count ?? 0) || shipments || plans || recalled)
        throw new ConflictException('Chuỗi còn giao nhận, phần lượng đối soát, kế hoạch hoặc lô thu hồi chưa xử lý');
      const result = await tx.chainBusinessProfile.update({
        where: { chainId },
        data: { state: 'SUSPENDED', version: { increment: 1 }, suspendedAt: new Date(), suspendedBy: actor.sub!, suspensionReason: reason.trim() },
      });
      await this.audit(tx, actor, 'SUSPEND_BUSINESS_PROFILE', chainId, result.version, chainId);
      return result;
    });
  }
  invite(actor: CommandActor, chainId: string, organizationId: string) {
    return this.transaction(async (tx) => {
      await this.activeOrganization(tx, organizationId);
      if (
        await tx.chainMembership.findUnique({
          where: { chainId_organizationId: { chainId, organizationId } },
        })
      )
        throw new ConflictException(
          'Thành viên đã tồn tại; dùng chuyển trạng thái có version',
        );
      const member = await tx.chainMembership.create({
        data: { chainId, organizationId },
      });
      await this.audit(
        tx,
        actor,
        'INVITE_MEMBER',
        member.id,
        member.version,
        chainId,
      );
      return member;
    });
  }
  changeMember(
    actor: CommandActor,
    chainId: string,
    organizationId: string,
    version: number,
    status: ChangeMemberDto['status'] | 'ACTIVE',
  ) {
    return this.transaction(async (tx) => {
      const chain = await tx.supplyChain.findUniqueOrThrow({
        where: { id: chainId },
      });
      if (chain.ownerOrganizationId === organizationId)
        throw new ForbiddenException(
          'Không thể thu hồi hoặc đổi membership chủ chuỗi',
        );
      const member = await tx.chainMembership.findUnique({
        where: { chainId_organizationId: { chainId, organizationId } },
      });
      if (!member) throw new NotFoundException('Không tìm thấy thành viên');
      if (member.version !== version)
        throw new ConflictException('Version thành viên đã thay đổi');
      const allowed =
        status === 'ACTIVE'
          ? member.status === 'INVITED'
          : status === 'INVITED'
            ? ['SUSPENDED', 'REVOKED'].includes(member.status)
            : member.status !== 'REVOKED' && member.status !== status;
      if (!allowed)
        throw new ConflictException('Chuyển trạng thái không hợp lệ');
      if (status === 'ACTIVE')
        await this.activeOrganization(tx, organizationId);
      // Rejoining requires fresh authority; old grants never revive implicitly.
      if (status !== 'ACTIVE') {
        const revoking = await tx.scopedRoleGrant.findMany({
          where: { chainId, organizationId, revokedAt: null },
          select: { id: true },
        });
        await tx.scopedRoleGrant.updateMany({
          where: { chainId, organizationId, revokedAt: null },
          data: { revokedAt: new Date(), revision: { increment: 1 } },
        });
        // The API denies at once; the ledger side drains behind a barrier.
        for (const item of revoking)
          await requestLedgerRevoke(
            tx,
            item.id,
            'NORMAL',
            `membership ${status}`,
          );
      }
      const result = await tx.chainMembership.update({
        where: { id: member.id },
        data: {
          status,
          version: { increment: 1 },
          ...(status === 'INVITED'
            ? { invitationRevision: { increment: 1 } }
            : {}),
          updatedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        actor,
        `MEMBER_${status}`,
        member.id,
        result.version,
        chainId,
      );
      return result;
    });
  }
  grant(actor: CommandActor, organizationId: string, input: GrantRoleDto) {
    return this.transaction((tx) => {
      // A platform administrator cannot grant CREATE_CHAIN alone once the
      // two-person approval policy is enforced; use POST /platform-approvals.
      if (
        actor.role === 'SYSTEM_ADMIN' &&
        input.role === 'CREATE_CHAIN' &&
        approvalsMode() === 'ENFORCED'
      )
        throw new ConflictException(APPROVAL_REQUIRED_MESSAGE);
      return this.grantTx(tx, actor, organizationId, input);
    });
  }
  /** Grant body shared by the direct command and an approved proposal. */
  async grantTx(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    organizationId: string,
    input: GrantRoleDto,
  ) {
    {
      if (actor.role === 'SYSTEM_ADMIN') await lockPlatformAudit(tx);
      await this.activeOrganization(tx, organizationId);
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (['ORG_ADMIN', 'CREATE_CHAIN'].includes(input.role)) {
        const enrollment = await tx.enterpriseEnrollment.findUnique({
          where: { organizationId },
        });
        if (
          (user?.enterpriseTier && user.enterpriseTier > 1) ||
          (enrollment && enrollment.ownerId !== user?.id)
        )
          throw new ForbiddenException(
            'Quyền quản trị doanh nghiệp thuộc tài khoản cấp 1; không cấp vượt mô hình ủy quyền',
          );
      }
      if (
        !user ||
        user.organizationId !== organizationId ||
        user.accountStatus !== 'ACTIVE'
      )
        throw new ForbiddenException('User không hoạt động trong tổ chức');
      const orgRole = ['ORG_ADMIN', 'CREATE_CHAIN'].includes(input.role);
      if (orgRole === !!input.chainId)
        throw new ForbiddenException('Role và loại scope không khớp');
      if (input.chainId) {
        const member = await tx.chainMembership.findUnique({
          where: {
            chainId_organizationId: { chainId: input.chainId, organizationId },
          },
        });
        if (member?.status !== 'ACTIVE')
          throw new ForbiddenException('Tổ chức chưa là thành viên hoạt động');
        const capability =
          BUSINESS_CAPABILITIES[
            input.role as keyof typeof BUSINESS_CAPABILITIES
          ];
        if (
          capability &&
          !(await tx.organizationCapability.findFirst({
            where: { organizationId, code: capability, revokedAt: null },
          }))
        )
          throw new ForbiddenException('Chưa có capability phù hợp');
        if (input.role === 'CHAIN_MANAGER') {
          const chain = await tx.supplyChain.findUniqueOrThrow({
            where: { id: input.chainId },
          });
          if (chain.ownerOrganizationId !== organizationId)
            throw new ForbiddenException('Manager thuộc tổ chức chủ chuỗi');
        }
      }
      if (
        await tx.scopedRoleGrant.findFirst({
          where: {
            userId: input.userId,
            organizationId,
            chainId: input.chainId ?? null,
            role: input.role,
            revokedAt: null,
          },
        })
      )
        throw new ConflictException('Quyền đang có hiệu lực');
      const grant = await tx.scopedRoleGrant.create({
        data: {
          userId: input.userId,
          organizationId,
          chainId: input.chainId,
          scope: orgRole ? 'ORGANIZATION' : 'CHAIN',
          role: input.role,
        },
      });
      await this.audit(tx, actor, 'GRANT_ROLE', grant.id, 0, input.chainId);
      await requestLedgerGrant(tx, grant);
      if (actor.role === 'SYSTEM_ADMIN')
        await appendPlatformAudit(tx, {
          actor: { sub: actor.sub, role: actor.role },
          action: 'ROLE_GRANTED',
          subjectType: 'SCOPED_ROLE_GRANT',
          subjectId: grant.id,
          organizationId,
          details: {
            role: input.role,
            userId: input.userId,
            chainId: input.chainId ?? null,
          },
        });
      return grant;
    }
  }
  revokeGrant(
    actor: CommandActor,
    organizationId: string,
    grantId: string,
    chainId: string | undefined,
    version: number,
  ) {
    return this.transaction(async (tx) => {
      if (actor.role === 'SYSTEM_ADMIN') await lockPlatformAudit(tx);
      const grant = await tx.scopedRoleGrant.findUnique({
        where: { id: grantId },
      });
      if (
        !grant ||
        grant.organizationId !== organizationId ||
        grant.chainId !== (chainId ?? null)
      )
        throw new NotFoundException('Không tìm thấy quyền');
      if (
        actor.role !== 'SYSTEM_ADMIN' &&
        !['FARM_STAFF', 'TRANSPORTER', 'RETAILER'].includes(grant.role)
      )
        throw new ForbiddenException(
          'Org admin không thu hồi quyền nền tảng cấp',
        );
      if (grant.revision !== version || grant.revokedAt)
        throw new ConflictException('Quyền đã thay đổi');
      const result = await tx.scopedRoleGrant.update({
        where: { id: grantId },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      await requestLedgerRevoke(tx, grantId, 'NORMAL', 'grant revoked');
      await this.audit(
        tx,
        actor,
        'REVOKE_ROLE',
        grant.id,
        result.revision,
        chainId,
      );
      if (actor.role === 'SYSTEM_ADMIN')
        await appendPlatformAudit(tx, {
          actor: { sub: actor.sub, role: actor.role },
          action: 'ROLE_REVOKED',
          subjectType: 'SCOPED_ROLE_GRANT',
          subjectId: grant.id,
          organizationId,
          details: { role: grant.role, chainId: chainId ?? null },
        });
      return result;
    });
  }
  capability(
    actor: CommandActor,
    organizationId: string,
    code: keyof typeof import('../../generated/prisma/enums.js').OrganizationType,
  ) {
    return this.transaction((tx) => {
      if (actor.role === 'SYSTEM_ADMIN' && approvalsMode() === 'ENFORCED')
        throw new ConflictException(APPROVAL_REQUIRED_MESSAGE);
      return this.capabilityTx(tx, actor, organizationId, code);
    });
  }
  /** Capability grant shared by the direct command and an approved proposal. */
  async capabilityTx(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    organizationId: string,
    code: keyof typeof import('../../generated/prisma/enums.js').OrganizationType,
  ) {
    if (actor.role === 'SYSTEM_ADMIN') await lockPlatformAudit(tx);
    await this.activeOrganization(tx, organizationId);
    const current = await tx.organizationCapability.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
    if (current && !current.revokedAt)
      throw new ConflictException('Capability đang có hiệu lực');
    const result = await tx.organizationCapability.upsert({
      where: { organizationId_code: { organizationId, code } },
      create: { organizationId, code },
      update: { revokedAt: null, revision: { increment: 1 } },
    });
    await this.audit(
      tx,
      actor,
      `CAPABILITY_${code}`,
      organizationId,
      result.revision,
    );
    if (actor.role === 'SYSTEM_ADMIN')
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action: 'CAPABILITY_GRANTED',
        subjectType: 'ORGANIZATION',
        subjectId: organizationId,
        organizationId,
        details: { code, revision: result.revision },
      });
    return result;
  }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    // Management commands revalidate session, org authority and chain authority
    // under locks before writing the result journal. Bound the whole operation,
    // including lock wait, while accommodating a remote PostgreSQL connection.
    return commandTransaction(this.prisma, work, {
      timeout: 15000,
      maxWait: 5000,
    });
  }

  private async activeOrganization(tx: Prisma.TransactionClient, id: string) {
    const org = await tx.organization.findUnique({ where: { id } });
    if (org?.status !== 'ACTIVE')
      throw new ForbiddenException('Tổ chức không hoạt động');
  }
  private audit(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    operation: string,
    subjectId: string,
    revision: number,
    chainId?: string,
  ) {
    return tx.chainAudit.create({
      data: {
        actorUserId: actor.sub!,
        operation,
        subjectId,
        revision,
        chainId,
      },
    });
  }
}
