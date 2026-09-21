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
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  CreateShipmentDto,
  DamageShipmentDto,
  ReceiveShipmentDto,
  RejectShipmentDto,
  ShipmentTransitionDto,
} from './dto.js';
import { ShipmentsService } from './shipments.service.js';

@ApiTags('shipments')
@ApiBearerAuth()
@ApiHeader({ name: 'Idempotency-Key', required: true })
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly service: ShipmentsService,
    private readonly idempotency: IdempotencyService,
  ) {}
  private run(
    operation: string,
    key: string,
    req: AuthenticatedRequest,
    payload: unknown,
    fn: () => Promise<unknown>,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        operation,
        requestType: 'COMMAND',
        payload,
      },
      fn,
    );
  }
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @Post()
  create(
    @Body() dto: CreateShipmentDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CREATE_SHIPMENT', key, req, dto, () =>
      this.service.create(dto, req.user),
    );
  }
  @Roles('SYSTEM_ADMIN', 'TRANSPORTER')
  @Post(':id/start')
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShipmentTransitionDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('START_SHIPMENT', key, req, { id, ...dto }, () =>
      this.service.start(id, dto, req.user),
    );
  }
  @Roles('SYSTEM_ADMIN', 'TRANSPORTER')
  @Post(':id/arrive')
  arrive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShipmentTransitionDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('ARRIVE_SHIPMENT', key, req, { id, ...dto }, () =>
      this.service.arrive(id, dto, req.user),
    );
  }
  @Roles('SYSTEM_ADMIN', 'RETAILER')
  @Post(':id/receive')
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveShipmentDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('RECEIVE_SHIPMENT', key, req, { id, ...dto }, () =>
      this.service.receive(id, dto, req.user),
    );
  }
  @Roles('SYSTEM_ADMIN', 'RETAILER')
  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectShipmentDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('REJECT_SHIPMENT', key, req, { id, ...dto }, () =>
      this.service.reject(id, dto, req.user),
    );
  }
  @Roles('SYSTEM_ADMIN', 'TRANSPORTER', 'RETAILER')
  @Post(':id/damage')
  damage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DamageShipmentDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('DAMAGE_SHIPMENT', key, req, { id, ...dto }, () =>
      this.service.damage(id, dto, req.user),
    );
  }
}
