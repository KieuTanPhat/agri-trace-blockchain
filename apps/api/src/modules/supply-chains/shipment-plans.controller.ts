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
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ShipmentPlansService } from './shipment-plans.service.js';
import {
  AcceptShipmentPlanDto,
  CreateShipmentPlanDto,
  PlanAcceptanceResultDto,
  PlanFinalizeResultDto,
  ReviseShipmentPlanDto,
  ShipmentPlanRecordDto,
  ShipmentPlanVersionDto,
  PlanningLotDto,
} from './shipment-plan.dto.js';

@ApiTags('shipment-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('supply-chains/:chainId/shipment-plans')
export class ShipmentPlansController {
  constructor(
    private readonly service: ShipmentPlansService,
    private readonly idem: IdempotencyService,
  ) {}
  private command<T>(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: () => Promise<T>,
  ) {
    return this.idem.executeCommand(
      {
        actor: req.user,
        requesterId: req.user.sub,
        idempotencyKey: key,
        operation,
        requestType: 'COMMAND',
        responseStatus: 201,
        payload,
      },
      work,
    );
  }
  @Get()
  @ApiDataResponse(ShipmentPlanRecordDto, 200, true)
  list(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
  ) {
    return this.service.list(req.user, chainId);
  }
  @Get('planning-lots')
  @ApiDataResponse(PlanningLotDto, 200, true)
  planningLots(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
  ) {
    return this.service.planningLots(req.user, chainId);
  }
  @Get(':planId')
  @ApiDataResponse(ShipmentPlanRecordDto)
  get(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.service.get(req.user, chainId, planId);
  }
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(ShipmentPlanRecordDto, 201)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Body() dto: CreateShipmentPlanDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'SCOPE_CREATE_SHIPMENT_PLAN',
      { ...dto, chainId },
      () => this.service.create(req.user, chainId, dto.lotId, dto),
    );
  }
  @Post(':planId/revise')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(ShipmentPlanRecordDto, 201)
  revise(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: ReviseShipmentPlanDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'SCOPE_REVISE_SHIPMENT_PLAN',
      { ...dto, chainId, planId },
      () => this.service.revise(req.user, planId, dto.version, dto),
    );
  }
  @Post(':planId/accept')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(PlanAcceptanceResultDto, 201)
  accept(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: AcceptShipmentPlanDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'SCOPE_ACCEPT_SHIPMENT_PLAN',
      { ...dto, chainId, planId },
      () => this.service.accept(req.user, planId, dto),
    );
  }
  @Post(':planId/cancel')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(ShipmentPlanRecordDto, 201)
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: ShipmentPlanVersionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'SCOPE_CANCEL_SHIPMENT_PLAN',
      { ...dto, chainId, planId },
      () => this.service.cancel(req.user, planId, dto.version),
    );
  }
  @Post(':planId/finalize')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(PlanFinalizeResultDto, 201)
  finalize(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: ShipmentPlanVersionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'SCOPE_FINALIZE_SHIPMENT_PLAN',
      { ...dto, chainId, planId },
      () => this.service.finalize(req.user, planId, dto.version),
    );
  }
}
