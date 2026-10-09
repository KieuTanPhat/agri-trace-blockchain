import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { clearRefreshCookie, readRefreshCookie, refreshCookie } from './auth-cookie.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() input: RegisterDto) {
    return this.authService.register(input);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedOrigin(request);
    const { refreshToken, refreshExpiresAt, ...publicResult } =
      await this.authService.login(input);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', refreshCookie(refreshToken, refreshExpiresAt));
    return publicResult;
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedOrigin(request);
    const token = readRefreshCookie(request.headers.cookie);
    if (!token) {
      throw new UnauthorizedException('Không có phiên đăng nhập hợp lệ');
    }
    try {
      const { refreshToken, refreshExpiresAt, ...publicResult } =
        await this.authService.refresh({ refreshToken: token });
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Set-Cookie', refreshCookie(refreshToken, refreshExpiresAt));
      return publicResult;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        response.setHeader('Set-Cookie', clearRefreshCookie());
      }
      throw error;
    }
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedOrigin(request);
    const token = readRefreshCookie(request.headers.cookie);
    if (token) await this.authService.logout({ refreshToken: token });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', clearRefreshCookie());
    return { revoked: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.authService.getProfile(request.user.sub);
  }

  private assertTrustedOrigin(request: Request): void {
    const origin = request.headers.origin;
    const trusted = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((value) => value.trim());
    if (
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (origin && !trusted.includes(origin))
    ) {
      throw new ForbiddenException('Nguồn yêu cầu không được phép');
    }
  }
}
