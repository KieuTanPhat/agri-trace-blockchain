import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hash(input.password, 12),
        fullName: input.fullName?.trim() || null,
        organizationId: input.organizationId,
      },
      select: this.safeUserSelect,
    });

    return this.createAuthResponse(user);
  }

  async login(input: LoginDto) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản hiện không hoạt động');
    }

    const { passwordHash: _passwordHash, ...safeUser } = user;
    return this.createAuthResponse(safeUser);
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

  private createAuthResponse(user: {
    id: string;
    email: string;
    role: string;
    [key: string]: unknown;
  }) {
    return {
      accessToken: this.jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      }),
      tokenType: 'Bearer',
      user,
    };
  }

  private readonly safeUserSelect = {
    id: true,
    email: true,
    fullName: true,
    organizationId: true,
    role: true,
    accountStatus: true,
    createdAt: true,
    updatedAt: true,
  } as const;
}
