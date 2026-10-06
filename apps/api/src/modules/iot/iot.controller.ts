import {
  Body,
  Controller,
  Get,
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
import { DeviceKeyGuard } from './device-key.guard.js';
import {
  CreateSensorDigestDto,
  CreateTelemetryDigestDto,
  BindShipmentDeviceDto,
  CreateIotDeviceDto,
  IngestSensorReadingDto,
  IngestShipmentTelemetryDto,
} from './dto.js';
import { IotService } from './iot.service.js';

@ApiTags('iot')
@Controller('iot')
export class IotController {
  constructor(
    private readonly service: IotService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private run(
    operation: string,
    key: string,
    requesterId: string,
    payload: unknown,
    command: () => Promise<unknown>,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId,
        operation,
        requestType: 'IOT_INGEST',
        payload,
      },
      command,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'AUDITOR')
  @Get('devices')
  devices(@Req() request: AuthenticatedRequest) {
    return this.service.listDevices(request.user);
  }

  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER')
  @Post('devices')
  createDevice(
    @Body() input: CreateIotDeviceDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run('CREATE_IOT_DEVICE', key, request.user.sub, input, () =>
      this.service.createDevice(input, request.user),
    );
  }

  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @Post('readings')
  ingestForUser(
    @Body() input: IngestSensorReadingDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run('INGEST_SENSOR_READING', key, request.user.sub, input, () =>
      this.service.ingest(input, request.user),
    );
  }

  @ApiHeader({ name: 'X-Device-Key', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(DeviceKeyGuard)
  @Post('device-readings')
  ingestForDevice(
    @Body() input: IngestSensorReadingDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.run(
      'INGEST_SENSOR_READING',
      key,
      `device:${input.deviceId}`,
      input,
      () => this.service.ingest(input),
    );
  }

  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @Post('cycles/:cycleId/digests')
  createSensorDigest(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Body() input: CreateSensorDigestDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'CREATE_SENSOR_DIGEST',
      key,
      request.user.sub,
      { cycleId, ...input },
      () => this.service.createSensorDigest(cycleId, input, request.user),
    );
  }

  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'TRANSPORTER')
  @Post('shipments/:shipmentId/telemetry')
  ingestTelemetryForUser(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() input: IngestShipmentTelemetryDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'INGEST_SHIPMENT_TELEMETRY',
      key,
      request.user.sub,
      { shipmentId, ...input },
      () =>
        this.service.ingestShipmentTelemetry(
          shipmentId,
          input,
          key,
          request.user,
        ),
    );
  }

  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'TRANSPORTER')
  @Post('shipments/:shipmentId/devices')
  bindShipmentDevice(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() input: BindShipmentDeviceDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'BIND_SHIPMENT_DEVICE',
      key,
      request.user.sub,
      { shipmentId, ...input },
      () => this.service.bindShipmentDevice(shipmentId, input, request.user),
    );
  }

  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'TRANSPORTER')
  @Post('shipments/:shipmentId/devices/:deviceId/unbind')
  unbindShipmentDevice(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'UNBIND_SHIPMENT_DEVICE',
      key,
      request.user.sub,
      { shipmentId, deviceId },
      () =>
        this.service.unbindShipmentDevice(shipmentId, deviceId, request.user),
    );
  }

  @ApiHeader({ name: 'X-Device-Key', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(DeviceKeyGuard)
  @Post('shipments/:shipmentId/device-telemetry')
  ingestTelemetryForDevice(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() input: IngestShipmentTelemetryDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.run(
      'INGEST_SHIPMENT_TELEMETRY',
      key,
      `device:${input.deviceId}`,
      { shipmentId, ...input },
      () => this.service.ingestShipmentTelemetry(shipmentId, input, key),
    );
  }

  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'TRANSPORTER')
  @Post('shipments/:shipmentId/telemetry-digests')
  createTelemetryDigest(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() input: CreateTelemetryDigestDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'CREATE_SHIPMENT_TELEMETRY_DIGEST',
      key,
      request.user.sub,
      { shipmentId, ...input },
      () => this.service.createTelemetryDigest(shipmentId, input, request.user),
    );
  }
}
