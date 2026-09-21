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
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  CancelCycleDto,
  CareRecordDto,
  CreateProductionCycleDto,
  PlantCycleDto,
  SensorReadingDto,
  VersionedCommandDto,
} from './dto.js';
import { ProductionCyclesService } from './production-cycles.service.js';

@ApiTags('production-cycles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'FARM_STAFF')
@Controller('production-cycles')
export class ProductionCyclesController {
  constructor(
    private readonly service: ProductionCyclesService,
    private readonly idempotency: IdempotencyService,
  ) {}
  private run(
    operation: string,
    key: string,
    request: AuthenticatedRequest,
    payload: unknown,
    command: () => Promise<unknown>,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId: request.user.sub,
        operation,
        requestType: 'COMMAND',
        payload,
      },
      command,
    );
  }

  @Get()
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR')
  list(@Req() req: AuthenticatedRequest) {
    return this.service.list(req.user);
  }

  @Get(':id')
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.get(id, req.user);
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post() create(
    @Body() dto: CreateProductionCycleDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CREATE_PRODUCTION_CYCLE', key, req, dto, () =>
      this.service.create(dto, req.user),
    );
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/plant') plant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlantCycleDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('PLANT_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.plant(id, dto, req.user),
    );
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/care') care(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CareRecordDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('RECORD_CARE', key, req, { id, ...dto }, () =>
      this.service.addCare(id, dto, req.user),
    );
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/sensor-readings') sensor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SensorReadingDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('RECORD_SENSOR', key, req, { id, ...dto }, () =>
      this.service.addSensorReading(id, dto, req.user),
    );
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/close') close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedCommandDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CLOSE_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.close(id, dto, req.user),
    );
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/cancel') cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCycleDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CANCEL_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.cancel(id, dto, req.user),
    );
  }
}
