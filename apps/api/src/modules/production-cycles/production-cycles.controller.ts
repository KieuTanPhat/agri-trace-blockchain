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
@ApiHeader({ name: 'Idempotency-Key', required: true })
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
  @Post() create(
    @Body() dto: CreateProductionCycleDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CREATE_PRODUCTION_CYCLE', key, req, dto, () =>
      this.service.create(dto, req.user),
    );
  }
  @Post(':id/plant') plant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlantCycleDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('PLANT_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.plant(id, dto, req.user),
    );
  }
  @Post(':id/care') care(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CareRecordDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('RECORD_CARE', key, req, { id, ...dto }, () =>
      this.service.addCare(id, dto, req.user),
    );
  }
  @Post(':id/sensor-readings') sensor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SensorReadingDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('RECORD_SENSOR', key, req, { id, ...dto }, () =>
      this.service.addSensorReading(id, dto, req.user),
    );
  }
  @Post(':id/close') close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionedCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CLOSE_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.close(id, dto, req.user),
    );
  }
  @Post(':id/cancel') cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCycleDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('CANCEL_PRODUCTION_CYCLE', key, req, { id, ...dto }, () =>
      this.service.cancel(id, dto, req.user),
    );
  }
}
