import {
  Body,
  Controller,
  Get,
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
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  PrepareIntentOptionsDto,
  SigningIntentDto,
  SubmitSignatureDto,
} from '../signing/dto.js';
import {
  CancelHandoverDto,
  HandoverDto,
  PrepareHandoverOfferDto,
  RejectHandoverDto,
} from './handovers.dto.js';
import { HandoversService } from './handovers.service.js';

/** Release C two-party handover. Preparing an intent changes no business
 * state; submitting the signed intent is the idempotent command. */
@ApiTags('handovers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class HandoversController {
  constructor(
    private readonly service: HandoversService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('shipments/:shipmentId/handovers')
  @ApiDataResponse(HandoverDto, 200, true)
  list(
    @Req() req: AuthenticatedRequest,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
  ) {
    return this.service.list(shipmentId, req.user);
  }

  @Post('shipments/:shipmentId/handover-offers/intent')
  @ApiDataResponse(SigningIntentDto, 201)
  prepareOffer(
    @Req() req: AuthenticatedRequest,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() input: PrepareHandoverOfferDto,
  ) {
    return this.service.prepareOffer(shipmentId, input, req.user);
  }

  @Post('handovers/:handoverId/confirmation/intent')
  @ApiDataResponse(SigningIntentDto, 201)
  prepareConfirm(
    @Req() req: AuthenticatedRequest,
    @Param('handoverId', ParseUUIDPipe) handoverId: string,
    @Body() input: PrepareIntentOptionsDto,
  ) {
    return this.service.prepareConfirm(handoverId, input, req.user);
  }

  @Get('signing-intents/:intentId')
  @ApiDataResponse(SigningIntentDto)
  intent(
    @Req() req: AuthenticatedRequest,
    @Param('intentId', ParseUUIDPipe) intentId: string,
  ) {
    return this.service.getIntent(intentId, req.user);
  }

  @Post('signing-intents/:intentId/submit')
  @ApiDataResponse(HandoverDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  submit(
    @Req() req: AuthenticatedRequest,
    @Param('intentId', ParseUUIDPipe) intentId: string,
    @Body() input: SubmitSignatureDto,
    @IdempotencyKey() key: string,
  ) {
    return this.run(
      req,
      key,
      'SUBMIT_SIGNED_INTENT',
      { intentId, ...input },
      () => this.service.submit(intentId, input, req.user),
    );
  }

  @Post('handovers/:handoverId/reject')
  @ApiDataResponse(HandoverDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  reject(
    @Req() req: AuthenticatedRequest,
    @Param('handoverId', ParseUUIDPipe) handoverId: string,
    @Body() input: RejectHandoverDto,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'REJECT_HANDOVER', { handoverId, ...input }, () =>
      this.service.reject(handoverId, input, req.user),
    );
  }

  @Post('handovers/:handoverId/cancel')
  @ApiDataResponse(HandoverDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('handoverId', ParseUUIDPipe) handoverId: string,
    @Body() input: CancelHandoverDto,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'CANCEL_HANDOVER', { handoverId, ...input }, () =>
      this.service.cancel(handoverId, input, req.user),
    );
  }

  private run<T>(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: () => Promise<T>,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        operation,
        requestType: 'COMMAND',
        responseStatus: 201,
        payload,
      },
      work,
    );
  }
}
