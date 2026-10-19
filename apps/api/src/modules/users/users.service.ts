import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { lockSessionOwner } from '../auth/session-family.js';
import { isPlatformAdminRole } from '../auth/role-codes.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from '../platform-governance/platform-audit.js';
import {
  APPROVAL_REQUIRED_MESSAGE,
  PLATFORM_ROLES,
  approvalsMode,
} from '../platform-governance/platform-config.js';
import type {
  CreateUserDto,
  ResetUserPasswordDto,
  RevokeUserSessionsDto,
  UnlockUserDto,
  UpdateUserStatusDto,
} from './dto.js';

export interface PlatformCommandActor {
  sub: string | null;
  role: string;
}

interface NewPlatformUser {
  email: string;
  fullName: string;
  passwordHash: string;
  roleCode: string;
  organizationId?: string | null;
  mustChangePassword?: boolean;
}

const PUBLIC_USER = {
  id: true,
  email: true,
  fullName: true,
  accountStatus: true,
  version: true,
  lockedUntil: true,
  mustChangePassword: true,
  updatedAt: true,
} as const;

/** User creation body shared by the direct command and an approved
 * SYSTEM_ADMIN_CREATE proposal. Runs on the caller's command transaction. */
export async function createPlatformUserTx(
  tx: Prisma.TransactionClient,
  actor: PlatformCommandActor,
  input: NewPlatformUser,
) {
  await lockPlatformAudit(tx);
  const email = input.email.trim().toLowerCase();
  if (await tx.user.findFirst({ where: { email } })) {
    throw new ConflictException('Email đã tồn tại');
  }
  const role = await tx.role.findUnique({ where: { code: input.roleCode } });
  if (!role) throw new UnprocessableEntityException('Role không hợp lệ');
  if (!(PLATFORM_ROLES as readonly string[]).includes(role.code))
    throw new ForbiddenException(
      'Tài khoản doanh nghiệp do doanh nghiệp quản lý',
    );
  if (isPlatformAdminRole(role.code) && input.organizationId)
    throw new UnprocessableEntityException(
      'Quản trị hệ thống không thuộc doanh nghiệp',
    );
  if (!isPlatformAdminRole(role.code) && !input.organizationId) {
    throw new UnprocessableEntityException(
      'Tài khoản nghiệp vụ phải thuộc một tổ chức',
    );
  }
  if (
    input.organizationId &&
    !(await tx.organization.findUnique({ where: { id: input.organizationId } }))
  ) {
    throw new UnprocessableEntityException('Organization does not exist');
  }
  if (role.code === 'COMPLIANCE_REVIEWER') {
    const organization = await tx.organization.findUnique({
      where: { id: input.organizationId! },
    });
    if (
      !organization ||
      organization.type !== 'AUDITOR' ||
      organization.status !== 'ACTIVE'
    )
      throw new UnprocessableEntityException(
        'Reviewer phải thuộc tổ chức AUDITOR đang hoạt động',
      );
  }
  const user = await tx.user.create({
    data: {
      email,
      fullName: input.fullName.trim(),
      passwordHash: input.passwordHash,
      roleId: role.id,
      organizationId: input.organizationId ?? null,
      // The administrator chose the password: the owner replaces it first.
      mustChangePassword: input.mustChangePassword ?? true,
      passwordChangedAt: new Date(),
    },
    select: { id: true, email: true, fullName: true, accountStatus: true },
  });
  await appendPlatformAudit(tx, {
    actor,
    action: 'USER_CREATED',
    subjectType: 'USER',
    subjectId: user.id,
    organizationId: input.organizationId ?? null,
    details: { email, roleCode: role.code },
  });
  return user;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      select: {
        ...PUBLIC_USER,
        createdAt: true,
        role: { select: { code: true, name: true } },
        organization: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  roles() {
    return this.prisma.role.findMany({
      where: { code: { in: [...PLATFORM_ROLES] } },
      orderBy: { code: 'asc' },
    });
  }

  async create(actor: PlatformCommandActor, input: CreateUserDto) {
    // Creating another SYSTEM_ADMIN needs a second administrator once the
    // two-person policy is enforced; see PlatformApprovalsService.
    if (isPlatformAdminRole(input.roleCode) && approvalsMode() === 'ENFORCED')
      throw new ConflictException(APPROVAL_REQUIRED_MESSAGE);
    const passwordHash = await hash(input.password, 12);
    return commandTransaction(this.prisma, (tx) =>
      createPlatformUserTx(tx, actor, {
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        roleCode: input.roleCode,
        organizationId: input.organizationId,
      }),
    );
  }

  /** Locks the row (organization first, then user: the session lock order),
   * re-reads it and enforces platform scope plus the optimistic version. */
  private async lockedPlatformUser(
    tx: Prisma.TransactionClient,
    id: string,
    version: number | undefined,
  ) {
    await lockPlatformAudit(tx);
    const probe = await tx.user.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!probe) throw new NotFoundException('Không tìm thấy người dùng');
    await lockSessionOwner(tx, id, probe.organizationId);
    const user = await tx.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (!(PLATFORM_ROLES as readonly string[]).includes(user.role.code))
      throw new ForbiddenException(
        'Tài khoản doanh nghiệp do doanh nghiệp quản lý',
      );
    if (version !== undefined && user.version !== version)
      throw new ConflictException('Tài khoản đã thay đổi; tải lại trạng thái');
    return user;
  }

  async updateStatus(
    actor: PlatformCommandActor,
    id: string,
    input: UpdateUserStatusDto,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      const existing = await this.lockedPlatformUser(tx, id, input.version);
      if (id === actor.sub && input.accountStatus !== 'ACTIVE')
        throw new ConflictException(
          'Không thể tự khóa hoặc vô hiệu hóa chính mình',
        );
      const unchanged =
        existing.accountStatus === input.accountStatus &&
        !(
          input.accountStatus === 'ACTIVE' &&
          (existing.lockedUntil || existing.failedLoginCount > 0)
        );
      if (unchanged)
        throw new ConflictException('Tài khoản đã ở trạng thái này');
      if (
        input.accountStatus !== 'ACTIVE' &&
        existing.accountStatus === 'ACTIVE' &&
        existing.role.code === 'SYSTEM_ADMIN' &&
        (await tx.user.count({
          where: {
            id: { not: id },
            accountStatus: 'ACTIVE',
            role: { code: 'SYSTEM_ADMIN' },
          },
        })) === 0
      )
        throw new ConflictException(
          'Không thể vô hiệu hóa quản trị viên hoạt động cuối cùng',
        );
      const user = await tx.user.update({
        where: { id },
        data: {
          accountStatus: input.accountStatus,
          version: { increment: 1 },
          ...(input.accountStatus === 'ACTIVE'
            ? { failedLoginCount: 0, lockedUntil: null }
            : {}),
        },
        select: PUBLIC_USER,
      });
      let revoked = 0;
      if (input.accountStatus !== 'ACTIVE')
        revoked = (
          await tx.refreshSession.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          })
        ).count;
      await appendPlatformAudit(tx, {
        actor,
        action: 'USER_STATUS_CHANGED',
        subjectType: 'USER',
        subjectId: id,
        organizationId: existing.organizationId,
        reason: input.reason,
        details: {
          from: existing.accountStatus,
          to: input.accountStatus,
          sessionsRevoked: revoked,
        },
      });
      return user;
    });
  }

  /** Clears a temporary login lockout without changing the account status. */
  async unlock(actor: PlatformCommandActor, id: string, input: UnlockUserDto) {
    return commandTransaction(this.prisma, async (tx) => {
      const existing = await this.lockedPlatformUser(tx, id, input.version);
      if (!existing.lockedUntil && existing.failedLoginCount === 0)
        throw new ConflictException('Tài khoản không bị khóa tạm thời');
      const user = await tx.user.update({
        where: { id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
        select: PUBLIC_USER,
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'USER_UNLOCKED',
        subjectType: 'USER',
        subjectId: id,
        organizationId: existing.organizationId,
        reason: input.reason,
        details: { failedLoginCount: existing.failedLoginCount },
      });
      return user;
    });
  }

  async revokeSessions(
    actor: PlatformCommandActor,
    id: string,
    input: RevokeUserSessionsDto,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      const existing = await this.lockedPlatformUser(tx, id, undefined);
      const { count } = await tx.refreshSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'USER_SESSIONS_REVOKED',
        subjectType: 'USER',
        subjectId: id,
        organizationId: existing.organizationId,
        reason: input.reason,
        details: { sessionsRevoked: count },
      });
      return { id, sessionsRevoked: count };
    });
  }

  /** The administrator chooses a temporary password (never returned, logged or
   * audited); the user must change it at first sign-in. Taking over another
   * administrator's account this way would defeat two-person control, so with
   * the approval policy enforced a SYSTEM_ADMIN target needs an approval. */
  async resetPassword(
    actor: PlatformCommandActor,
    id: string,
    input: ResetUserPasswordDto,
  ) {
    const passwordHash = await hash(input.temporaryPassword, 12);
    return commandTransaction(this.prisma, async (tx) => {
      const existing = await this.lockedPlatformUser(tx, id, input.version);
      if (
        isPlatformAdminRole(existing.role.code) &&
        approvalsMode() === 'ENFORCED'
      )
        throw new ConflictException(APPROVAL_REQUIRED_MESSAGE);
      return this.applyPasswordReset(
        tx,
        actor,
        existing,
        passwordHash,
        input.reason,
      );
    });
  }

  /** Reset body shared by the direct command and an approved ADMIN_PASSWORD_RESET. */
  async resetPasswordTx(
    tx: Prisma.TransactionClient,
    actor: PlatformCommandActor,
    id: string,
    passwordHash: string,
    reason: string,
  ) {
    const existing = await this.lockedPlatformUser(tx, id, undefined);
    return this.applyPasswordReset(tx, actor, existing, passwordHash, reason);
  }

  private async applyPasswordReset(
    tx: Prisma.TransactionClient,
    actor: PlatformCommandActor,
    existing: { id: string; organizationId: string | null },
    passwordHash: string,
    reason: string,
  ) {
    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        version: { increment: 1 },
      },
      select: PUBLIC_USER,
    });
    const { count } = await tx.refreshSession.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await appendPlatformAudit(tx, {
      actor,
      action: 'USER_PASSWORD_RESET',
      subjectType: 'USER',
      subjectId: existing.id,
      organizationId: existing.organizationId,
      reason,
      details: { sessionsRevoked: count, mustChangePassword: true },
    });
    return user;
  }
}
