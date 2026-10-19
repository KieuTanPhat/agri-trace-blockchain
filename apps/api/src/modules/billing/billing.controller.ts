import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { BillingService } from './billing.service.js';
import {
  BillingListDto,
  BillingReasonInput,
  BillingRecordDto,
  ConfirmPaymentInput,
  EnterpriseBillingDto,
  EnterpriseInvoicePayInput,
  EnterpriseRenewalInput,
  InvoiceQuery,
  InvoiceVersionInput,
  IssueRenewalInput,
  PlanVersionDraftInput,
  RevenueQuery,
  RevenueReportDto,
  SubscriptionQuery,
} from './billing.dto.js';

const KEY = { name: 'Idempotency-Key', required: true } as const;

abstract class CommandController {
  constructor(protected readonly idem: IdempotencyService) {}
  protected command<T>(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: () => Promise<T>,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation,
        requestType: 'COMMAND',
        payload,
      },
      work,
    );
  }
}

/** Service catalog, subscriptions, invoices and revenue. Payments are either
 * simulated (local only) or confirmed manually against a bank reference. */
@ApiTags('platform-billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('platform-billing')
export class PlatformBillingController extends CommandController {
  constructor(
    private readonly service: BillingService,
    idem: IdempotencyService,
  ) {
    super(idem);
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR')
  @Get('plans')
  @ApiDataResponse(BillingListDto)
  plans() {
    return this.service.plans();
  }

  @Roles('SYSTEM_ADMIN')
  @Post('plans/:code/versions')
  @ApiHeader(KEY)
  @ApiDataResponse(BillingRecordDto, 201)
  draft(
    @Param('code') code: string,
    @Body() input: PlanVersionDraftInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(req, key, 'PLATFORM_BILLING_PLAN_DRAFT', { ...input, code }, () =>
      this.service.draftVersion(req.user, code, input),
    );
  }

  @Roles('SYSTEM_ADMIN')
  @Post('plan-versions/:id/publish')
  @ApiHeader(KEY)
  @ApiDataResponse(BillingRecordDto, 201)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: BillingReasonInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(req, key, 'PLATFORM_BILLING_PLAN_PUBLISH', { ...input, id }, () =>
      this.service.publishVersion(req.user, id, input.reason),
    );
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR')
  @Get('subscriptions')
  @ApiDataResponse(BillingListDto)
  subscriptions(@Query() query: SubscriptionQuery) {
    return this.service.subscriptions(query);
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR')
  @Get('invoices')
  @ApiDataResponse(BillingListDto)
  invoices(@Query() query: InvoiceQuery) {
    return this.service.invoices(query);
  }

  @Roles('SYSTEM_ADMIN')
  @Post('invoices/:id/confirm-payment')
  @ApiHeader(KEY)
  @ApiDataResponse(BillingRecordDto, 201)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ConfirmPaymentInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(req, key, 'PLATFORM_BILLING_CONFIRM_PAYMENT', { ...input, id }, () =>
      this.service.confirmPayment(req.user, id, input),
    );
  }

  @Roles('SYSTEM_ADMIN')
  @Post('invoices/:id/void')
  @ApiHeader(KEY)
  @ApiDataResponse(BillingRecordDto, 201)
  voidInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: InvoiceVersionInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(req, key, 'PLATFORM_BILLING_VOID_INVOICE', { ...input, id }, () =>
      this.service.voidInvoice(req.user, id, input),
    );
  }

  @Roles('SYSTEM_ADMIN')
  @Post('organizations/:id/renewal-invoices')
  @ApiHeader(KEY)
  @ApiDataResponse(BillingRecordDto, 201)
  renewal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: IssueRenewalInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(req, key, 'PLATFORM_BILLING_ISSUE_RENEWAL', { ...input, organizationId: id }, () =>
      this.service.issueRenewal(req.user, id, input),
    );
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR')
  @Get('revenue')
  @ApiDataResponse(RevenueReportDto)
  revenue(@Query() query: RevenueQuery) {
    return this.service.revenue(query.months ?? 12);
  }
}

@ApiTags('enterprise-billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enterprise-billing')
export class EnterpriseBillingController extends CommandController {
  constructor(
    private readonly service: BillingService,
    idem: IdempotencyService,
  ) {
    super(idem);
  }

  @Get()
  @ApiDataResponse(EnterpriseBillingDto)
  mine(@Req() req: AuthenticatedRequest) {
    return this.service.mine(req.user);
  }

  @Post('renewals')
  @ApiHeader(KEY)
  @ApiDataResponse(BillingRecordDto, 201)
  renew(
    @Body() input: EnterpriseRenewalInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(req, key, 'ENTERPRISE_BILLING_RENEW', input, () =>
      this.service.requestRenewal(req.user, input),
    );
  }

  @Post('invoices/:id/payment-simulation')
  @ApiHeader(KEY)
  @ApiDataResponse(BillingRecordDto, 201)
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: EnterpriseInvoicePayInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(req, key, 'ENTERPRISE_BILLING_PAY_SIMULATION', { ...input, id }, () =>
      this.service.paySimulated(req.user, id, input),
    );
  }
}
