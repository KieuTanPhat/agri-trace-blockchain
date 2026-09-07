import {
  CanActivate,
  ExecutionContext,
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
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
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
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }

    if (typeof payload?.sub !== 'string' || !isUUID(payload.sub)) {
      throw new UnauthorizedException(
        'Token thiếu định danh người dùng hợp lệ',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        accountStatus: true,
      },
    });

    if (!user || user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại hoặc không hoạt động',
      );
    }

    request.user = {
      sub: user.id,
      email: user.email,
      role: user.role.code,
      organizationId: user.organizationId,
      accountStatus: user.accountStatus,
    };
    return true;
  }
}
