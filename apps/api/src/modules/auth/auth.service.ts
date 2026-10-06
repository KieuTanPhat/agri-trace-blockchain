import {
  Injectable,
  Inject,
  NotImplementedException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';

@Injectable()
export class AuthService {
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

  async login(input: LoginDto) {
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
      },
    });

    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản hiện không hoạt động');
    }

    const { passwordHash: _passwordHash, ...safeUser } = user;

    return this.createAuthResponse(safeUser);
  }

  async refresh(input: RefreshTokenDto) {
    const tokenHash = this.hashRefreshToken(input.refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: this.safeUserSelect,
        },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.accountStatus !== 'ACTIVE'
    )
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );

    const nextToken = randomBytes(48).toString('base64url');
    const nextHash = this.hashRefreshToken(nextToken);
    const expiresAt = this.refreshExpiry();
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1)
        throw new UnauthorizedException('Refresh token đã được sử dụng');
      await tx.refreshSession.create({
        data: { userId: session.userId, tokenHash: nextHash, expiresAt },
      });
    });
    return this.authPayload(session.user, nextToken, expiresAt);
  }

  async logout(input: RefreshTokenDto) {
    await this.prisma.refreshSession.updateMany({
      where: {
        tokenHash: this.hashRefreshToken(input.refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
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

  private async createAuthResponse(user: {
    id: string;
    email: string;
    role: {
      code: string;
    };
    [key: string]: unknown;
  }) {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = this.refreshExpiry();
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt,
      },
    });
    return this.authPayload(user, refreshToken, expiresAt);
  }

  private authPayload(
    user: {
      id: string;
      email: string;
      role: { code: string };
      [key: string]: unknown;
    },
    refreshToken: string,
    refreshExpiresAt: Date,
  ) {
    return {
      accessToken: this.jwtService.sign({
        sub: user.id,
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
