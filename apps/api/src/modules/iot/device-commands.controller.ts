import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsUUID } from 'class-validator';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { CommandRequestStatusDto } from '../../common/idempotency/command-requests.controller.js';
import {
  DeviceKeyGuard,
  type DeviceAuthenticatedRequest,
} from './device-key.guard.js';

export class InspectDeviceCommandDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() deviceId!: string;
  @ApiProperty({ enum: ['INGEST_SENSOR_READING', 'INGEST_SHIPMENT_TELEMETRY'] })
  @IsIn(['INGEST_SENSOR_READING', 'INGEST_SHIPMENT_TELEMETRY'])
  operation!: string;
  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description:
      'Payload gốc gồm deviceId và cycleId hoặc shipmentId; giữ nguyên key/body để đối soát.',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}

@ApiTags('iot')
@Controller('iot/device-commands')
@UseGuards(DeviceKeyGuard)
export class DeviceCommandsController {
  constructor(private readonly idempotency: IdempotencyService) {}

  @Post('status')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Device-Key', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(CommandRequestStatusDto)
  inspect(
    @Body() input: InspectDeviceCommandDto,
    @IdempotencyKey() key: string,
    @Req() request: DeviceAuthenticatedRequest,
  ) {
    if (input.payload.deviceId !== input.deviceId)
      throw new ForbiddenException('Payload không thuộc thiết bị đã xác thực');
    return this.idempotency.inspectCommand({
      actor: null,
      requesterId: `device:${input.deviceId}`,
      operation: input.operation,
      payload: input.payload,
      idempotencyKey: key,
      deviceAuthentication: request.deviceAuthentication,
    });
  }
}
