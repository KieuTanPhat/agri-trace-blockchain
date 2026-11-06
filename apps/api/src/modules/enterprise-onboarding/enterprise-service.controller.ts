import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
  ServiceContractFileView,
} from './service-order.dto.js';
import { VIETNAM_ADDRESSES } from './address-catalog.js';
import { serviceCatalog } from './service-catalog.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { catalogDigest, publishedCatalog } from '../billing/billing-core.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import {
  CapabilityAddInput,
  CapabilityAddView,
  ParticipationUpgradeInput,
  ParticipationUpgradeView,
  requestCapability,
  upgradeToChainOwner,
} from './participation.js';

@ApiTags('reference-data')
@Controller('reference-data')
export class EnterpriseReferenceController {
  constructor(private readonly db: PrismaService) {}
  @Get('addresses')
  @ApiDataResponse(AddressProvinceView, 200, true)
  addresses() {
    return VIETNAM_ADDRESSES;
  }
  @Get('service-plans')
  @ApiDataResponse(ServiceCatalogView)
  async plans() {
    const plans = await publishedCatalog(this.db);
    return serviceCatalog(plans, catalogDigest(plans));
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
    private readonly db: PrismaService,
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
  @Get('enterprise-service/documents/:kind/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiDataResponse(ServiceContractFileView)
  document(
    @Req() req: AuthenticatedRequest,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.document(req.user, kind, id);
  }
  @Post('enterprise-service/preview')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Idempotent PDF snapshot preview; acceptance is a separate command.',
  })
  @ApiDataResponse(ServicePreviewView, 201)
  preview(
    @Req() req: AuthenticatedRequest,
    @Body() input: ServiceQuoteInput,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'ENTERPRISE_SERVICE_PREVIEW',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.preview(req.user, input),
    );
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
  @Post('enterprise-service/upgrade')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(ParticipationUpgradeView, 201)
  upgrade(
    @Req() req: AuthenticatedRequest,
    @Body() input: ParticipationUpgradeInput,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'ENTERPRISE_UPGRADE_OWNER',
        requestType: 'COMMAND',
        payload: input,
      },
      () =>
        commandTransaction(this.db, (tx) =>
          upgradeToChainOwner(tx, req.user, input),
        ),
    );
  }
  @Post('capability-requests')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(CapabilityAddView, 201)
  requestCapability(
    @Req() req: AuthenticatedRequest,
    @Body() input: CapabilityAddInput,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'ENTERPRISE_CAPABILITY_REQUEST',
        requestType: 'COMMAND',
        payload: input,
      },
      () =>
        commandTransaction(this.db, (tx) =>
          requestCapability(tx, req.user, input),
        ),
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
