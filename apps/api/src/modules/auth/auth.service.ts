import {
  ConflictException,
  Injectable,
  Inject,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { lockSessionOwner, sessionFamilyWhere } from './session-family.js';
import { registerEnterprise } from '../enterprise-onboarding/enterprise-onboarding.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import { PlatformMfaService } from '../platform-governance/platform-mfa.service.js';
import { isPlatformAdminRole } from './role-codes.js';
import { registrationEmailInUse } from '../enterprise-onboarding/registration-email.js';
import { enforcePasswordAge } from './password-age.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from '../platform-governance/platform-audit.js';
import {
  PLATFORM_ROLES,
  loginLockMinutes,
  loginMaxAttempts,
} from '../platform-governance/platform-config.js';

const GENERIC_LOGIN_ERROR = 'Email hoặc mật khẩu không chính xác';
// Unknown and locked accounts still pay for one bcrypt comparison so response
// time does not reveal whether an email exists or is temporarily locked.
let dummyHash: Promise<string> | undefined;
const timingHash = () => (dummyHash ??= hash('agritrace-timing-equalizer', 12));
const isPlatformRole = (code: string) =>
  (PLATFORM_ROLES as readonly string[]).includes(code);
const MACHINE_ROLES = ['IOT_DEVICE', 'SYSTEM_ACTOR'];

/**
 * The client a session family belongs to. Web uses HttpOnly cookies and takes
 * any non-consumer account. Native families carry the refresh token in the
 * request body and are limited to their own app: consumer accounts on ACheck,
 * enterprise members (no platform or machine role) on the staff app.
 */
export type SessionAudience = 'web' | 'consumer' | 'staff';
export function audienceAllows(
  audience: SessionAudience,
  user: { role: { code: string }; organizationId: string | null },
) {
  const role = user.role.code;
  if (audience === 'consumer')
    return role === 'CONSUMER' && user.organizationId === null;
  if (role === 'CONSUMER') return false;
  if (audience === 'staff')
    return (
      user.organizationId !== null &&
      !isPlatformRole(role) &&
      !MACHINE_ROLES.includes(role)
    );
  return true;
}

@Injectable()
export class AuthService {
  private readonly concurrentRefreshWindowMs = 5_000;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Optional() @Inject(ConfigService) private readonly config?: ConfigService,
    @Optional()
    @Inject(PlatformMfaService)
    private readonly mfa?: PlatformMfaService,
  ) {}

  register(input: RegisterDto) {
    return registerEnterprise(
      this.prisma,
      input,
      this.config?.getOrThrow<string>('JWT_SECRET') ?? process.env.JWT_SECRET!,
    );
  }

  async registrationEmailAvailability(email: string) {
    return { available: !(await registrationEmailInUse(this.prisma, email)) };
  }

  async login(input: LoginDto, previousRefreshToken?: string) {
    return this.loginAccount(input, previousRefreshToken);
  }

  async loginConsumer(
    phone: string,
    password: string,
    previousRefreshToken?: string,
  ) {
    return this.loginAccount(
      { email: '', password },
      previousRefreshToken,
      phone,
    );
  }

  /** Staff app sign-in: same credentials and checks as the web, native family. */
  async loginStaff(input: LoginDto, previousRefreshToken?: string) {
    return this.loginAccount(input, previousRefreshToken, undefined, 'staff');
  }

  private async loginAccount(
    input: LoginDto,
    previousRefreshToken?: string,
    consumerPhone?: string,
    audience: SessionAudience = consumerPhone ? 'consumer' : 'web',
  ) {
    const email = input.email.trim().toLowerCase();

    // The live database enforces case-insensitive uniqueness through
    // ux_app_user_email_lower, an expression index Prisma cannot expose as a
    // findUnique selector.
    const user = await this.prisma.user.findFirst({
      where: consumerPhone ? { loginPhone: consumerPhone } : { email },
      include: {
        role: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        organization: { select: { status: true } },
      },
    });

    const loginError = consumerPhone
      ? 'Số điện thoại hoặc mật khẩu không chính xác'
      : GENERIC_LOGIN_ERROR;
    // Consumer accounts sign in only by phone on ACheck, and business accounts
    // only by email: a wrong-kind account answers exactly like a wrong password.
    const wrongKind = !!user && !audienceAllows(audience, user);
    if (!user || wrongKind) {
      await compare(input.password, await timingHash());
      throw new UnauthorizedException(loginError);
    }
    const platform = isPlatformRole(user.role.code);
    if (platform && user.lockedUntil && user.lockedUntil > new Date()) {
      // Locked: identical answer to a wrong password, never a distinct message.
      await compare(input.password, await timingHash());
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    if (!(await compare(input.password, user.passwordHash))) {
      // Bookkeeping must never turn a rejected sign-in into a 500.
      if (platform) await this.recordFailedLogin(user).catch(() => undefined);
      throw new UnauthorizedException(loginError);
    }

    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản hiện không hoạt động');
    }
    if (user.organizationId && user.organization?.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tổ chức hiện không hoạt động');
    }
    // Validate/retire the previous native family BEFORE issuing a new one.
    // A wrong-kind previous credential must not leave an unreturned active family.
    if (audience !== 'web' && previousRefreshToken) {
      await this.logout({ refreshToken: previousRefreshToken }, audience);
    }

    let failedSecondFactor = false;
    const result = await this.prisma
      .$transaction(async (tx) => {
        // Platform attempts, temporary locking and session issuance share the
        // same lock order. A password checked before a concurrent lock cannot
        // create a new session after that lock has committed.
        if (platform) await lockPlatformAudit(tx);
        await lockSessionOwner(tx, user.id, user.organizationId, 'read');
        const current = await tx.user.findUnique({
          where: { id: user.id },
          include: { role: true, organization: { select: { status: true } } },
        });
        if (
          !current ||
          current.passwordHash !== user.passwordHash ||
          current.role.code !== user.role.code ||
          current.accountStatus !== 'ACTIVE' ||
          (current.organizationId &&
            current.organization?.status !== 'ACTIVE') ||
          !audienceAllows(audience, current) ||
          (consumerPhone &&
            (current.organizationId !== null ||
              current.loginPhone !== consumerPhone ||
              !(await tx.consumerProfile.findUnique({
                where: { userId: current.id },
                select: { userId: true },
              }))))
        ) {
          throw new UnauthorizedException(
            'Tài khoản hoặc tổ chức không hoạt động',
          );
        }
        if (platform && current.lockedUntil && current.lockedUntil > new Date())
          throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
        if (this.mfa && isPlatformAdminRole(current.role.code)) {
          try {
            await this.mfa.assertLogin(
              tx,
              { id: current.id, role: current.role.code },
              input.mfaCode,
            );
          } catch (error) {
            failedSecondFactor =
              error instanceof UnauthorizedException && !!input.mfaCode?.trim();
            throw error;
          }
        }
        if (platform && (current.failedLoginCount > 0 || current.lockedUntil))
          await tx.user.update({
            where: { id: current.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
        if (await enforcePasswordAge(tx, current))
          current.mustChangePassword = true;
        const {
          passwordHash: _passwordHash,
          version: _version,
          failedLoginCount: _failedLoginCount,
          lockedUntil: _lockedUntil,
          passwordChangedAt: _passwordChangedAt,
          ...safeUser
        } = current;
        return this.createAuthResponse(tx, safeUser);
      })
      .catch(async (error: unknown) => {
        // Persist a rejected factor after the issuance transaction rolls back.
        // Missing codes and configuration faults never consume an attempt.
        if (failedSecondFactor)
          await this.recordFailedLogin(user).catch(() => undefined);
        throw error;
      });
    // A browser account switch also invalidates access tokens held by other
    // tabs. Logout uses the same DB locks as rotation, including old tokens.
    if (previousRefreshToken && audience === 'web') {
      await this.logout({ refreshToken: previousRefreshToken });
    }
    return result;
  }

  async refresh(input: RefreshTokenDto, audience: SessionAudience = 'web') {
    const tokenHash = this.hashRefreshToken(input.refreshToken);
    const owner = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: {
        userId: true,
        user: { select: { organizationId: true } },
      },
    });
    if (!owner)
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );

    const result = await this.prisma.$transaction(async (tx) => {
      await lockSessionOwner(tx, owner.userId, owner.user.organizationId);
      // Re-read after acquiring the locks: neither the token nor the account
      // snapshot from before this transaction may authorize a new session.
      const session = await tx.refreshSession.findUnique({
        where: { tokenHash },
        include: {
          user: { select: { ...this.safeUserSelect, passwordChangedAt: true } },
        },
      });
      if (!session) return { state: 'revoked' } as const;
      // A native credential refreshes only within its own app.
      if (
        audience !== 'web' &&
        (!audienceAllows(audience, session.user) ||
          (audience === 'consumer' &&
            !(await tx.consumerProfile.findUnique({
              where: { userId: session.userId },
              select: { userId: true },
            }))))
      )
        return { state: 'revoked' } as const;
      const familyId = session.familyId;
      if (
        session.user.accountStatus !== 'ACTIVE' ||
        (session.user.organizationId &&
          session.user.organization?.status !== 'ACTIVE')
      ) {
        await this.revokeFamily(tx, familyId);
        return { state: 'revoked' } as const;
      }
      if (session.revokedAt) {
        if (
          Date.now() - session.revokedAt.getTime() <=
          this.concurrentRefreshWindowMs
        ) {
          const active = await tx.refreshSession.findFirst({
            where: {
              ...sessionFamilyWhere(familyId),
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true },
          });
          return { state: active ? 'conflict' : 'revoked' } as const;
        }
        await this.revokeFamily(tx, familyId);
        return { state: 'revoked' } as const;
      }
      if (session.expiresAt <= new Date()) return { state: 'revoked' } as const;
      const { passwordChangedAt, ...sessionUser } = session.user;
      if (
        await enforcePasswordAge(tx, { ...sessionUser, passwordChangedAt })
      )
        sessionUser.mustChangePassword = true;

      const nextToken = randomBytes(48).toString('base64url');
      const expiresAt = session.expiresAt;
      const revoked = await tx.refreshSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) return { state: 'revoked' } as const;
      await tx.refreshSession.create({
        data: {
          userId: session.userId,
          familyId,
          tokenHash: this.hashRefreshToken(nextToken),
          expiresAt,
        },
      });
      return {
        state: 'rotated',
        payload: this.authPayload(sessionUser, familyId, nextToken, expiresAt),
      } as const;
    });
    // Throw after commit so replay/account revocation is not rolled back.
    if (result.state === 'conflict')
      throw new ConflictException('Refresh token đang được xoay vòng');
    if (result.state !== 'rotated')
      throw new UnauthorizedException('Phiên đã bị thu hồi hoặc hết hạn');
    return result.payload;
  }

  async logout(input: RefreshTokenDto, audience: SessionAudience = 'web') {
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: this.hashRefreshToken(input.refreshToken) },
      select: {
        id: true,
        familyId: true,
        userId: true,
        user: {
          select: { organizationId: true, role: { select: { code: true } } },
        },
      },
    });
    if (session) {
      if (audience !== 'web' && !audienceAllows(audience, session.user))
        throw new UnauthorizedException('Phiên không hợp lệ');
      await this.prisma.$transaction(async (tx) => {
        await lockSessionOwner(tx, session.userId, session.user.organizationId);
        await this.revokeFamily(tx, session.familyId);
      });
    }
    return { revoked: true };
  }

  /** Counts a failed sign-in for a platform account and applies a temporary
   * lock at the configured threshold. The lock is recorded in the audit chain
   * as a system event. Runs in its own transaction so it survives the 401. */
  private async recordFailedLogin(user: {
    id: string;
    organizationId: string | null;
    passwordHash: string;
  }) {
    const userId = user.id;
    await this.prisma.$transaction(async (tx) => {
      await lockPlatformAudit(tx);
      await lockSessionOwner(tx, userId, user.organizationId);
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: {
          failedLoginCount: true,
          lockedUntil: true,
          organizationId: true,
          passwordHash: true,
          role: { select: { code: true } },
        },
      });
      if (
        !current ||
        current.organizationId !== user.organizationId ||
        current.passwordHash !== user.passwordHash ||
        !isPlatformRole(current.role.code) ||
        (current.lockedUntil && current.lockedUntil > new Date())
      )
        return;
      const attempts = current.failedLoginCount + 1;
      if (attempts < loginMaxAttempts()) {
        await tx.user.update({
          where: { id: userId },
          data: { failedLoginCount: attempts },
        });
        return;
      }
      const lockedUntil = new Date(Date.now() + loginLockMinutes() * 60_000);
      await tx.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lockedUntil,
          version: { increment: 1 },
        },
      });
      await appendPlatformAudit(tx, {
        actor: null,
        action: 'USER_LOGIN_LOCKED',
        subjectType: 'USER',
        subjectId: userId,
        organizationId: current.organizationId,
        details: {
          attempts,
          lockedUntil: lockedUntil.toISOString(),
        },
      });
    });
  }

  /** Self-service password change. Every other session of the account is
   * revoked; the current session family stays signed in. */
  async changePassword(
    userId: string,
    currentSessionId: string,
    input: ChangePasswordDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: { select: { code: true } } },
    });
    if (!user || !(await compare(input.currentPassword, user.passwordHash)))
      throw new UnauthorizedException('Mật khẩu hiện tại không chính xác');
    if (await compare(input.newPassword, user.passwordHash))
      throw new ConflictException('Mật khẩu mới phải khác mật khẩu hiện tại');
    const passwordHash = await hash(input.newPassword, 12);
    return this.prisma.$transaction(async (tx) => {
      if (isPlatformRole(user.role.code)) await lockPlatformAudit(tx);
      await lockSessionOwner(tx, userId, user.organizationId);
      const changed = await tx.user.updateMany({
        where: { id: userId, passwordHash: user.passwordHash },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('Mật khẩu vừa được thay đổi; thử lại');
      const { count } = await tx.refreshSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          NOT: sessionFamilyWhere(currentSessionId),
        },
        data: { revokedAt: new Date() },
      });
      if (isPlatformRole(user.role.code))
        await appendPlatformAudit(tx, {
          actor: { sub: userId, role: user.role.code },
          action: 'PASSWORD_CHANGED',
          subjectType: 'USER',
          subjectId: userId,
          organizationId: user.organizationId,
          details: {
            sessionsRevoked: count,
            clearedForcedChange: user.mustChangePassword,
          },
        });
      return { changed: true, sessionsRevoked: count };
    });
  }

  /** Signs the account out everywhere, including the current session. */
  async logoutAll(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: { select: { code: true } } },
    });
    if (!user) return { revoked: true, sessionsRevoked: 0 };
    return this.prisma.$transaction(async (tx) => {
      if (isPlatformRole(user.role.code)) await lockPlatformAudit(tx);
      await lockSessionOwner(tx, userId, user.organizationId);
      const { count } = await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (isPlatformRole(user.role.code))
        await appendPlatformAudit(tx, {
          actor: { sub: userId, role: user.role.code },
          action: 'USER_SESSIONS_REVOKED_SELF',
          subjectType: 'USER',
          subjectId: userId,
          organizationId: user.organizationId,
          details: { sessionsRevoked: count },
        });
      return { revoked: true, sessionsRevoked: count };
    });
  }

  private async revokeFamily(tx: Prisma.TransactionClient, familyId: string) {
    await tx.refreshSession.updateMany({
      where: { ...sessionFamilyWhere(familyId), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.safeUserSelect,
    });

    if (!user) {
      throw new UnauthorizedException('Người dùng không còn tồn tại');
    }

    return user;
  }

  async createAuthResponse(
    tx: Prisma.TransactionClient,
    user: {
      id: string;
      email: string;
      role: {
        code: string;
      };
      [key: string]: unknown;
    },
  ) {
    const refreshToken = randomBytes(48).toString('base64url');
    const familyId = randomUUID();
    const expiresAt = this.refreshExpiry();
    await tx.refreshSession.create({
      data: {
        id: familyId,
        familyId,
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt,
      },
    });
    return this.authPayload(user, familyId, refreshToken, expiresAt);
  }

  private authPayload(
    user: {
      id: string;
      email: string;
      role: { code: string };
      [key: string]: unknown;
    },
    familyId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ) {
    return {
      sessionId: familyId,
      accessToken: this.jwtService.sign({
        sub: user.id,
        sid: familyId,
        email: user.email,
        role: user.role.code,
      }),
      tokenType: 'Bearer',
      refreshToken,
      refreshExpiresAt,
      user,
    };
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private refreshExpiry() {
    const days = Number(this.config?.get('JWT_REFRESH_EXPIRES_DAYS') ?? 30);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private readonly safeUserSelect = {
    id: true,
    email: true,
    fullName: true,
    organizationId: true,
    organization: { select: { status: true } },
    role: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    accountStatus: true,
    mustChangePassword: true,
    createdAt: true,
    updatedAt: true,
  } as const;
}
