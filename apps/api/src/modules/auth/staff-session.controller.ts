import {
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Inject,
  Injectable,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { AuthService } from './auth.service.js';
import { StaffPasswordResetService } from './staff-password-reset.service.js';
import { assertNativeOrigin } from './mobile-auth.controller.js';
import { MobileLogoutResultDto, MobileRefreshDto } from './mobile-auth.dto.js';
import {
  StaffPasswordResetRequestDto,
  StaffPasswordResetConfirmDto,
  StaffPasswordResetVerifyDto,
  StaffPasswordResetVerifyResultDto,
  StaffPasswordResetRequestResultDto,
  StaffPasswordResetResultDto,
  StaffLoginDto,
  StaffSessionDto,
} from './staff-session.dto.js';

/** Closed by default, like consumer auth: production enables it explicitly. */
@Injectable()
export class StaffSessionGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    if (this.config.get('STAFF_APP_AUTH_ENABLED') !== 'true')
      throw new ServiceUnavailableException(
        'Ứng dụng nhân viên tạm chưa sẵn sàng',
      );
    assertNativeOrigin(
      context.switchToHttp().getRequest<Request>(),
      this.config,
    );
    return true;
  }
}

/**
 * Native sessions for the staff app. The refresh token travels in the body and
 * lives in device secure storage instead of a cookie; authorization for every
 * business call stays with the existing controllers and their scope checks.
 */
@Controller('auth/staff')
@ApiTags('staff-auth')
@UseGuards(StaffSessionGuard)
export class StaffSessionController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(StaffPasswordResetService)
    private readonly reset: StaffPasswordResetService,
  ) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiDataResponse(StaffSessionDto, 201)
  login(@Body() input: StaffLoginDto) {
    const { previousRefreshToken, ...credentials } = input;
    return this.auth.loginStaff(credentials, previousRefreshToken);
  }

  @Post('password-reset/request')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiDataResponse(StaffPasswordResetRequestResultDto, 201)
  requestPasswordReset(@Body() input: StaffPasswordResetRequestDto) {
    return this.reset.request(input);
  }

  @Post('password-reset/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiDataResponse(StaffPasswordResetVerifyResultDto, 201)
  verifyPasswordReset(@Body() input: StaffPasswordResetVerifyDto) {
    return this.reset.verify(input);
  }

  @Post('password-reset/confirm')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiDataResponse(StaffPasswordResetResultDto, 201)
  confirmPasswordReset(@Body() input: StaffPasswordResetConfirmDto) {
    return this.reset.confirm(input);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiDataResponse(StaffSessionDto, 201)
  async refresh(
    @Body() input: MobileRefreshDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return await this.auth.refresh(
        { refreshToken: input.refreshToken },
        'staff',
      );
    } catch (error) {
      if (error instanceof ConflictException)
        response.setHeader('Retry-After', '1');
      throw error;
    }
  }

  @Post('logout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiDataResponse(MobileLogoutResultDto, 201)
  logout(@Body() input: MobileRefreshDto) {
    return this.auth.logout({ refreshToken: input.refreshToken }, 'staff');
  }
}
