import {
  Body,
  ConflictException,
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
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  clearRefreshCookie,
  readRefreshCookie,
  refreshCookie,
  sessionCookie,
  SESSION_COOKIE_NAME,
} from './auth-cookie.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import {
  AuthLogoutResponseDto,
  AuthProfileResponseDto,
  AuthSessionResponseDto,
} from './dto/auth-response.dto.js';

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() input: RegisterDto) {
    return this.authService.register(input);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Sign in and revoke the previous browser session',
    description:
      'Sets an HttpOnly session selector and a refresh cookie named agritrace_refresh_<sessionId>. Send both cookies on refresh/logout. Refresh responses only update their own family cookie.',
  })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials or inactive user/organization',
  })
  @ApiForbiddenResponse({ description: 'Untrusted request origin' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedOrigin(request);
    const previous = readRefreshCookie(request.headers.cookie);
    const { refreshToken, refreshExpiresAt, ...publicResult } =
      await this.authService.login(input, previous?.token);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', [
      sessionCookie(publicResult.sessionId, refreshExpiresAt),
      refreshCookie(publicResult.sessionId, refreshToken, refreshExpiresAt),
      ...(previous ? [clearRefreshCookie(previous.sessionId)] : []),
    ]);
    return publicResult;
  }

  @Post('refresh')
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @ApiOperation({
    summary: 'Rotate the selected refresh session',
    description:
      'Requires the selector and its HttpOnly family cookie. A concurrent rotation returns 409 without clearing cookies; retry after the winning response updates the cookie.',
  })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  @ApiUnauthorizedResponse({
    description:
      'Missing, expired, revoked or replayed session; JWTs without sid are rejected',
  })
  @ApiForbiddenResponse({ description: 'Untrusted request origin' })
  @ApiConflictResponse({
    description:
      'Concurrent rotation within 5 seconds; retry with the current cookie',
  })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedOrigin(request);
    const credential = readRefreshCookie(request.headers.cookie);
    if (!credential) {
      throw new UnauthorizedException('Không có phiên đăng nhập hợp lệ');
    }
    try {
      const { refreshToken, refreshExpiresAt, ...publicResult } =
        await this.authService.refresh({ refreshToken: credential.token });
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader(
        'Set-Cookie',
        refreshCookie(publicResult.sessionId, refreshToken, refreshExpiresAt),
      );
      return publicResult;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        response.setHeader(
          'Set-Cookie',
          clearRefreshCookie(credential.sessionId),
        );
      } else if (error instanceof ConflictException) {
        response.setHeader('Retry-After', '1');
      }
      throw error;
    }
  }

  @Post('logout')
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @ApiOperation({
    summary: 'Revoke all tokens in the selected session family',
    description:
      'Clears only this family cookie. The selector is intentionally not changed by refresh/logout, so a late response cannot replace or clear a newer login.',
  })
  @ApiCreatedResponse({ type: AuthLogoutResponseDto })
  @ApiForbiddenResponse({ description: 'Untrusted request origin' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedOrigin(request);
    const credential = readRefreshCookie(request.headers.cookie);
    if (credential)
      await this.authService.logout({ refreshToken: credential.token });
    response.setHeader('Cache-Control', 'no-store');
    if (credential)
      response.setHeader(
        'Set-Cookie',
        clearRefreshCookie(credential.sessionId),
      );
    return { revoked: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthProfileResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Invalid JWT or inactive user, organization or session',
  })
  getProfile(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
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
