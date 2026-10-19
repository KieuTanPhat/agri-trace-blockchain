import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { EnterpriseOnboardingGuard } from './enterprise-onboarding.guard.js';
import { EnterpriseServiceService } from './enterprise-service.service.js';
import {
  AddressProvinceView,
  EnterpriseAccessView,
  ServiceCatalogView,
  ServiceOrderInput,
  ServiceOrderView,
  ServicePaymentInput,
  ServicePreviewView,
  ServiceQuoteInput,
  ServiceWorkspaceView,
} from './service-order.dto.js';
import { VIETNAM_ADDRESSES } from './address-catalog.js';
import { serviceCatalog } from './service-catalog.js';

@ApiTags('reference-data')
@Controller('reference-data')
export class EnterpriseReferenceController {
  @Get('addresses')
  @ApiDataResponse(AddressProvinceView, 200, true)
  addresses() {
    return VIETNAM_ADDRESSES;
  }
  @Get('service-plans')
  @ApiDataResponse(ServiceCatalogView)
  plans() {
    return serviceCatalog();
  }
}
@ApiTags('enterprise-service')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EnterpriseOnboardingGuard)
@Controller()
export class EnterpriseServiceController {
  constructor(
    private readonly service: EnterpriseServiceService,
    private readonly idem: IdempotencyService,
  ) {}
  @Get('enterprise-access')
  @ApiDataResponse(EnterpriseAccessView)
  access(@Req() req: AuthenticatedRequest) {
    return this.service.access(req.user);
  }
  @Get('enterprise-service')
  @ApiDataResponse(ServiceWorkspaceView)
  mine(@Req() req: AuthenticatedRequest) {
    return this.service.mine(req.user);
  }
  @Post('enterprise-service/preview')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Preview request identifier. This operation is pure and does not create a contract.',
  })
  @ApiDataResponse(ServicePreviewView, 201)
  preview(
    @Req() req: AuthenticatedRequest,
    @Body() input: ServiceQuoteInput,
    @IdempotencyKey() key: string,
  ) {
    void key;
    return this.service.preview(req.user, input);
  }
  @Post('enterprise-service/orders')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(ServiceOrderView, 201)
  create(
    @Req() req: AuthenticatedRequest,
    @Body() input: ServiceOrderInput,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'ENTERPRISE_SERVICE_ORDER',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.create(req.user, input),
    );
  }
  @Post('enterprise-service/payment-simulation')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(ServiceOrderView, 201)
  pay(
    @Req() req: AuthenticatedRequest,
    @Body() input: ServicePaymentInput,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'ENTERPRISE_SERVICE_PAY',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.pay(req.user, input),
    );
  }
}
