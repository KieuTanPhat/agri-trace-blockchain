import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IotDeviceRecordDto } from '../../common/api/record.dto.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  CredentialMutationDto,
  DeviceCredentialMetadataDto,
  DeviceStatusDto,
  DeviceVersionDto,
  IssueDeviceCredentialDto,
} from './device-assets.dto.js';
import { DeviceAssetsService } from './device-assets.service.js';

@Controller('iot/devices')
@ApiTags('iot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class DeviceAssetsController {
  constructor(
    private readonly assets: DeviceAssetsService,
    private readonly idempotency: IdempotencyService,
  ) {}
  private run(
    operation: string,
    key: string,
    request: AuthenticatedRequest,
    payload: unknown,
    command: () => Promise<unknown>,
    status = 201,
  ) {
    return this.idempotency.executeCommand(
      {
        operation,
        idempotencyKey: key,
        requesterId: request.user.sub,
        actor: request.user,
        payload,
        requestType: 'IOT_ASSET',
        responseStatus: status,
      },
      command,
    );
  }
  @Get('managed')
  @ApiDataResponse(IotDeviceRecordDto, 200, true)
  list(@Req() request: AuthenticatedRequest) {
    return this.assets.list(request.user);
  }

  @Get(':deviceId/credentials')
  @ApiDataResponse(DeviceCredentialMetadataDto, 200, true)
  credentials(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assets.credentials(deviceId, request.user);
  }
  @Patch(':deviceId/status')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(IotDeviceRecordDto)
  status(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() input: DeviceStatusDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'IOT_DEVICE_STATUS',
      key,
      request,
      { deviceId, ...input },
      () => this.assets.status(deviceId, input, request.user),
      200,
    );
  }
  @Post(':deviceId/credentials')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(CredentialMutationDto, 201)
  issue(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() input: IssueDeviceCredentialDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'IOT_ISSUE_CREDENTIAL',
      key,
      request,
      { deviceId, ...input },
      () => this.assets.issue(deviceId, input, request.user, false),
    );
  }
  @Post(':deviceId/credentials/rotate')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(CredentialMutationDto, 201)
  rotate(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() input: IssueDeviceCredentialDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'IOT_ROTATE_CREDENTIAL',
      key,
      request,
      { deviceId, ...input },
      () => this.assets.issue(deviceId, input, request.user, true),
    );
  }
  @Post(':deviceId/credentials/:credentialId/revoke')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(CredentialMutationDto, 201)
  revoke(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Body() input: DeviceVersionDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.run(
      'IOT_REVOKE_CREDENTIAL',
      key,
      request,
      { deviceId, credentialId, ...input },
      () =>
        this.assets.revoke(deviceId, credentialId, input.version, request.user),
    );
  }
}
