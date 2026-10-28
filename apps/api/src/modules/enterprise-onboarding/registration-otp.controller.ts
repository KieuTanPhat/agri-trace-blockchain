import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { EnterpriseOnboardingGuard } from './enterprise-onboarding.guard.js';
import {
  RegistrationOtpRequest,
  RegistrationOtpVerify,
  RegistrationOtpReceipt,
  RegistrationOtpVerifiedView,
} from './registration-otp.dto.js';
import { RegistrationOtpService } from './registration-otp.service.js';
@ApiTags('registration-email')
@Controller('auth/registration-otp')
@UseGuards(EnterpriseOnboardingGuard)
export class RegistrationOtpController {
  constructor(private readonly service: RegistrationOtpService) {}
  private origin(req: Request) {
    const origin = req.headers.origin;
    if (
      origin &&
      !(process.env.CORS_ORIGIN ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(origin)
    )
      throw new ForbiddenException('Nguồn gửi yêu cầu không được cho phép');
  }
  @Post('request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Must equal requestId',
  })
  @ApiDataResponse(RegistrationOtpReceipt, 201)
  request(
    @Req() req: Request,
    @Body() input: RegistrationOtpRequest,
    @IdempotencyKey() key: string,
  ) {
    this.origin(req);
    if (key !== input.requestId)
      throw new ForbiddenException('Idempotency-Key phải khớp requestId');
    return this.service.request(input);
  }
  @Post('verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Must equal attemptId',
  })
  @ApiDataResponse(RegistrationOtpVerifiedView, 201)
  verify(
    @Req() req: Request,
    @Body() input: RegistrationOtpVerify,
    @IdempotencyKey() key: string,
  ) {
    this.origin(req);
    if (key !== input.attemptId)
      throw new ForbiddenException('Idempotency-Key phải khớp attemptId');
    return this.service.verify(input);
  }
}
