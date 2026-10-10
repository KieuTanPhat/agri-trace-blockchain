import {
  ConflictException,
  Injectable,
  Inject,
  NotImplementedException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { lockSessionOwner, sessionFamilyWhere } from './session-family.js';

@Injectable()
export class AuthService {
  private readonly concurrentRefreshWindowMs = 5_000;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Optional() @Inject(ConfigService) private readonly config?: ConfigService,
  ) {}

  register(_input: RegisterDto): never {
    throw new NotImplementedException(
      'Đăng ký đang tạm khóa; tài khoản sẽ do quản trị viên cấp',
    );
  }

  async login(input: LoginDto, previousRefreshToken?: string) {
    const email = input.email.trim().toLowerCase();

    // The live database enforces case-insensitive uniqueness through
    // ux_app_user_email_lower, an expression index Prisma cannot expose as a
    // findUnique selector.
    const user = await this.prisma.user.findFirst({
      where: { email },
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

    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản hiện không hoạt động');
    }
    if (user.organizationId && user.organization?.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tổ chức hiện không hoạt động');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await lockSessionOwner(tx, user.id, user.organizationId);
      const current = await tx.user.findUnique({
        where: { id: user.id },
        include: { role: true, organization: { select: { status: true } } },
      });
      if (
        !current ||
        current.passwordHash !== user.passwordHash ||
        current.accountStatus !== 'ACTIVE' ||
        (current.organizationId && current.organization?.status !== 'ACTIVE')
      ) {
        throw new UnauthorizedException(
          'Tài khoản hoặc tổ chức không hoạt động',
        );
      }
      const { passwordHash: _passwordHash, ...safeUser } = current;
      return this.createAuthResponse(tx, safeUser);
    });
    // A browser account switch also invalidates access tokens held by other
    // tabs. Logout uses the same DB locks as rotation, including old tokens.
    if (previousRefreshToken) {
      await this.logout({ refreshToken: previousRefreshToken });
    }
    return result;
  }

  async refresh(input: RefreshTokenDto) {
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
        include: { user: { select: this.safeUserSelect } },
      });
      if (!session) return { state: 'revoked' } as const;
      const familyId = session.familyId ?? session.id;
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
        payload: this.authPayload(session.user, familyId, nextToken, expiresAt),
      } as const;
    });
    // Throw after commit so replay/account revocation is not rolled back.
    if (result.state === 'conflict')
      throw new ConflictException('Refresh token đang được xoay vòng');
    if (result.state !== 'rotated')
      throw new UnauthorizedException('Phiên đã bị thu hồi hoặc hết hạn');
    return result.payload;
  }

  async logout(input: RefreshTokenDto) {
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: this.hashRefreshToken(input.refreshToken) },
      select: {
        id: true,
        familyId: true,
        userId: true,
        user: { select: { organizationId: true } },
      },
    });
    if (session) {
      await this.prisma.$transaction(async (tx) => {
        await lockSessionOwner(tx, session.userId, session.user.organizationId);
        await this.revokeFamily(tx, session.familyId ?? session.id);
      });
    }
    return { revoked: true };
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

  private async createAuthResponse(
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
    createdAt: true,
    updatedAt: true,
  } as const;
}
