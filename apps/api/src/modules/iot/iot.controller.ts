import { ApiDataResponse } from '../../common/api/openapi.js';
import {
  IotDeviceRecordDto,
  SensorDigestRecordDto,
  ShipmentTrackingBindingRecordDto,
  ShipmentTelemetryDigestRecordDto,
} from '../../common/api/record.dto.js';
import {
  DeviceListDto,
  ReadingAcceptedDto,
  TelemetryAcceptedDto,
  UnboundDto,
} from '../../common/api/response.dto.js';
import {
  FARM_WRITE_ROLES,
  TRANSPORT_WRITE_ROLES,
} from '../auth/business-write.policy.js';
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
import {
  ApiBearerAuth,
  ApiHeader,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
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
    requester: AuthenticatedRequest['user'] | string,
    payload: unknown,
    command: () => Promise<unknown>,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: typeof requester === 'string' ? requester : requester.sub,
        actor: typeof requester === 'string' ? null : requester,
        responseStatus: 201,
        operation,
        requestType: 'IOT_INGEST',
        payload,
      },
      command,
    );
  }

  @ApiDataResponse(DeviceListDto, 200, true)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'AUDITOR')
  @Get('devices')
  devices(@Req() request: AuthenticatedRequest) {
    return this.service.listDevices(request.user);
  }

  @ApiDataResponse(IotDeviceRecordDto, 201)
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
    return this.run('CREATE_IOT_DEVICE', key, request.user, input, () =>
      this.service.createDevice(input, request.user),
    );
  }

  @ApiDataResponse(ReadingAcceptedDto, 201)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FARM_WRITE_ROLES)
  @Post('readings')
  ingestForUser(
    @Body() input: IngestSensorReadingDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run('INGEST_SENSOR_READING', key, request.user, input, () =>
      this.service.ingest(input, request.user),
    );
  }

  @ApiDataResponse(ReadingAcceptedDto, 201)
  @ApiHeader({ name: 'X-Device-Key', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(DeviceKeyGuard)
  @ApiSecurity('deviceKey')
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

  @ApiDataResponse(SensorDigestRecordDto, 201)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FARM_WRITE_ROLES)
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
      request.user,
      { cycleId, ...input },
      () => this.service.createSensorDigest(cycleId, input, request.user),
    );
  }

  @ApiDataResponse(TelemetryAcceptedDto, 201)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...TRANSPORT_WRITE_ROLES)
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
      request.user,
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

  @ApiDataResponse(ShipmentTrackingBindingRecordDto, 201)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...TRANSPORT_WRITE_ROLES)
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
      request.user,
      { shipmentId, ...input },
      () => this.service.bindShipmentDevice(shipmentId, input, request.user),
    );
  }

  @ApiDataResponse(UnboundDto, 201)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...TRANSPORT_WRITE_ROLES)
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
      request.user,
      { shipmentId, deviceId },
      () =>
        this.service.unbindShipmentDevice(shipmentId, deviceId, request.user),
    );
  }

  @ApiDataResponse(TelemetryAcceptedDto, 201)
  @ApiHeader({ name: 'X-Device-Key', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(DeviceKeyGuard)
  @ApiSecurity('deviceKey')
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

  @ApiDataResponse(ShipmentTelemetryDigestRecordDto, 201)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...TRANSPORT_WRITE_ROLES)
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
      request.user,
      { shipmentId, ...input },
      () => this.service.createTelemetryDigest(shipmentId, input, request.user),
    );
  }
}
