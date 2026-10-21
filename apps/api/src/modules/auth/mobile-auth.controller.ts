import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiDataResponse } from '../../common/api/openapi.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { MobileAuthService } from './mobile-auth.service.js';
import {
  ConsumerProfileDto,
  MobileLoginDto,
  MobileLogoutResultDto,
  MobileRefreshDto,
  MobileRegisterDto,
  MobileResetDto,
  MobileResetResultDto,
  MobileSessionDto,
} from './mobile-auth.dto.js';

@Injectable()
export class MobileAuthGuard implements CanActivate {
  constructor(
    @Inject(MobileAuthService) private readonly service: MobileAuthService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  canActivate(context: ExecutionContext) {
    this.service.enabled();
    const request = context.switchToHttp().getRequest<Request>();
    const trusted = (
      this.config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000'
    )
      .split(',')
      .map((value) => value.trim());
    if (
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.headers.origin && !trusted.includes(request.headers.origin))
    )
      throw new ForbiddenException('Nguồn yêu cầu không được phép');
    return true;
  }
}

@Controller('auth/mobile')
@ApiTags('consumer-auth')
@UseGuards(MobileAuthGuard)
export class MobileAuthController {
  constructor(
    @Inject(MobileAuthService) private readonly service: MobileAuthService,
  ) {}
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiDataResponse(MobileSessionDto, 201)
  register(@Body() input: MobileRegisterDto) {
    return this.service.register(input);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiDataResponse(MobileSessionDto, 201)
  login(@Body() input: MobileLoginDto) {
    return this.service.login(
      input.phone,
      input.password,
      input.previousRefreshToken,
    );
  }

  @Post('password-reset')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiDataResponse(MobileResetResultDto, 201)
  reset(@Body() input: MobileResetDto) {
    return this.service.reset(input);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiDataResponse(MobileSessionDto, 201)
  async refresh(
    @Body() input: MobileRefreshDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return await this.service.refresh(input.refreshToken);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'getStatus' in error &&
        typeof error.getStatus === 'function' &&
        error.getStatus() === 409
      )
        response.setHeader('Retry-After', '1');
      throw error;
    }
  }
  @Post('logout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiDataResponse(MobileLogoutResultDto, 201)
  logout(@Body() input: MobileRefreshDto) {
    return this.service.logout(input.refreshToken);
  }
}

@Controller('consumer')
@ApiTags('consumer')
@UseGuards(MobileAuthGuard, JwtAuthGuard)
export class ConsumerController {
  constructor(
    @Inject(MobileAuthService) private readonly service: MobileAuthService,
  ) {}
  @Get('me')
  @ApiBearerAuth()
  @ApiDataResponse(ConsumerProfileDto)
  me(@Req() request: AuthenticatedRequest) {
    if (
      request.user.role !== 'CONSUMER' ||
      request.user.organizationId !== null
    )
      throw new ForbiddenException('Chỉ dành cho tài khoản người tiêu dùng');
    return this.service.me(request.user.sub);
  }
}
