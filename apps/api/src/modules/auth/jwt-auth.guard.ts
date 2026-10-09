import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedRequest, JwtPayload } from './auth.types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Thiếu Bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Access token đã hết hạn');
      }
      throw new UnauthorizedException('Access token không hợp lệ');
    }

    if (
      typeof payload?.sub !== 'string' || !isUUID(payload.sub) ||
      typeof payload?.sid !== 'string' || !isUUID(payload.sid)
    ) {
      throw new UnauthorizedException(
        'Token thiếu định danh người dùng hoặc phiên hợp lệ',
      );
    }

    // This lookup is deliberate: role, organization and account revocation must
    // take effect immediately. A cache is only safe with cross-instance
    // invalidation (for example Redis pub/sub), not an in-process TTL.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: { select: { code: true } },
        organizationId: true,
        organization: { select: { status: true } },
        accountStatus: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Tài khoản không còn tồn tại');
    }
    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản bị khóa hoặc không hoạt động');
    }

    if (user.organizationId && user.organization?.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tổ chức không còn hoạt động');
    }

    const activeSession = await this.prisma.refreshSession.findFirst({
      where: {
        familyId: payload.sid,
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!activeSession) {
      throw new UnauthorizedException('Phiên đăng nhập đã bị thu hồi hoặc hết hạn');
    }

    request.user = {
      sub: user.id,
      sid: payload.sid,
      email: user.email,
      role: user.role.code,
      organizationId: user.organizationId,
      accountStatus: user.accountStatus,
    };
    return true;
  }
}
