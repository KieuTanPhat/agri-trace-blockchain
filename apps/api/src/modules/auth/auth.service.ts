import {
  Injectable,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  register(_input: RegisterDto): never {
    throw new NotImplementedException(
      'Đăng ký đang tạm khóa; tài khoản sẽ do quản trị viên cấp',
    );
  }

  async login(input: LoginDto) {
    const email = input.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
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
      throw new UnauthorizedException(
        'Email hoặc mật khẩu không chính xác',
      );
    }

    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Tài khoản hiện không hoạt động',
      );
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
      throw new UnauthorizedException(
        'Người dùng không còn tồn tại',
      );
    }

    return user;
  }

  private createAuthResponse(user: {
    id: string;
    email: string;
    role: {
      code: string;
    };
    [key: string]: unknown;
  }) {
    return {
      accessToken: this.jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role.code,
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