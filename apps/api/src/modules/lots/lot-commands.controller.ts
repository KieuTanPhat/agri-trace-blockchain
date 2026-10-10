import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  DamageLotDto,
  LotReasonCommandDto,
  LotVersionCommandDto,
} from './dto.js';
import { LotCommandsService } from './lot-commands.service.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { LotCommandResultDto } from './lot-response.dto.js';

@ApiTags('lot-commands')
@ApiBearerAuth()
@ApiHeader({ name: 'Idempotency-Key', required: true })
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lots/:lotId')
export class LotCommandsController {
  constructor(
    private readonly service: LotCommandsService,
    private readonly idempotency: IdempotencyService,
  ) {}
  private run(
    id: string,
    input: LotVersionCommandDto,
    key: string,
    request: AuthenticatedRequest,
    operation: string,
    action: () => Promise<unknown>,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: request.user.sub,
        actor: request.user,
        operation,
        requestType: 'COMMAND',
        responseStatus: 201,
        payload: { lotId: id, ...input },
      },
      action,
    );
  }
  @Roles('RETAILER')
  @Post('mark-for-sale')
  @ApiDataResponse(LotCommandResultDto, 201)
  markForSale(
    @Param('lotId', ParseUUIDPipe) id: string,
    @Body() input: LotVersionCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(id, input, key, request, 'MARK_FOR_SALE', () =>
      this.service.markForSale(id, input, request.user),
    );
  }
  @Roles('RETAILER')
  @Post('mark-sold')
  @ApiDataResponse(LotCommandResultDto, 201)
  markSold(
    @Param('lotId', ParseUUIDPipe) id: string,
    @Body() input: LotVersionCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(id, input, key, request, 'MARK_SOLD', () =>
      this.service.markSold(id, input, request.user),
    );
  }
  @Roles('FARM_STAFF', 'TRANSPORTER', 'RETAILER')
  @Post('recall')
  @ApiDataResponse(LotCommandResultDto, 201)
  recall(
    @Param('lotId', ParseUUIDPipe) id: string,
    @Body() input: LotReasonCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(id, input, key, request, 'RECALL_LOT', () =>
      this.service.recall(id, input, request.user),
    );
  }
  @Roles('FARM_STAFF', 'TRANSPORTER', 'RETAILER')
  @Post('expire')
  @ApiDataResponse(LotCommandResultDto, 201)
  expire(
    @Param('lotId', ParseUUIDPipe) id: string,
    @Body() input: LotReasonCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(id, input, key, request, 'EXPIRE_LOT', () =>
      this.service.expire(id, input, request.user),
    );
  }
  @Roles('FARM_STAFF')
  @Post('damage')
  @ApiDataResponse(LotCommandResultDto, 201)
  damage(
    @Param('lotId', ParseUUIDPipe) id: string,
    @Body() input: DamageLotDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(id, input, key, request, 'DAMAGE_LOT', () =>
      this.service.damage(id, input, request.user),
    );
  }
}
