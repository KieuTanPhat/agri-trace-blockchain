import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  SensorHistoryQueryDto,
  ShipmentTelemetryQueryDto,
} from './dto.js';
import { SensorHistoryService } from './sensor-history.service.js';

@ApiTags('sensor-history')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  'SYSTEM_ADMIN',
  'FARM_STAFF',
  'TRANSPORTER',
  'RETAILER',
  'AUDITOR',
)
@Controller('sensor-history')
export class SensorHistoryController {
  constructor(
    private readonly service: SensorHistoryService,
  ) {}

  @Get('readings')
  getReadings(
    @Query() query: SensorHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getReadings(query, request.user);
  }

  @Get('summary')
  getReadingSummary(
    @Query() query: SensorHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getReadingSummary(
      query,
      request.user,
    );
  }

  @Get('shipment-telemetry')
  getShipmentTelemetry(
    @Query() query: ShipmentTelemetryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getShipmentTelemetry(
      query,
      request.user,
    );
  }

  @Get('shipment-summary')
  getShipmentSummary(
    @Query() query: ShipmentTelemetryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getShipmentSummary(
      query,
      request.user,
    );
  }
}