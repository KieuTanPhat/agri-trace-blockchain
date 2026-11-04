import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { WorkspaceListDto, WorkspaceRecordDto } from '../enterprise-workspace/dto.js';
import {
  BindDeviceInput,
  CycleReadingsQuery,
  DeviceAssignmentDto,
  DeviceAssignmentInput,
  DeviceIngestResultDto,
  DeviceStatusInput,
  RegisterDeviceInput,
  RotateDeviceKeyInput,
  SignedPositionsInput,
  SignedReadingsInput,
} from './device-dto.js';
import { DeviceIngestService } from './device-ingest.service.js';
import { DeviceRegistryService } from './device-registry.service.js';

/** ADR-006 enterprise device registry (users) and signed ingest (devices). */
@ApiTags('iot-devices')
@Controller('iot/v2')
export class DevicesController {
  constructor(
    private readonly registry: DeviceRegistryService,
    private readonly ingest: DeviceIngestService,
    private readonly idem: IdempotencyService,
  ) {}

  private run(req: AuthenticatedRequest, key: string, operation: string, payload: unknown, fn: () => Promise<unknown>) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation,
        payload,
        requestType: 'COMMAND',
      },
      fn,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('devices')
  @ApiDataResponse(WorkspaceListDto)
  list(@Req() req: AuthenticatedRequest) {
    return this.registry.list(req.user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('devices/:id')
  @ApiDataResponse(WorkspaceRecordDto)
  detail(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.registry.detail(req.user, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('device-options')
  @ApiDataResponse(WorkspaceRecordDto)
  options(@Req() req: AuthenticatedRequest) {
    return this.registry.options(req.user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('devices')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  register(@Req() req: AuthenticatedRequest, @Body() dto: RegisterDeviceInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_DEVICE_REGISTER', dto, () => this.registry.register(req.user, dto));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('devices/:id/binding')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  bind(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BindDeviceInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_DEVICE_BIND', { id, ...dto }, () => this.registry.bind(req.user, id, dto));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('devices/:id/key')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  rotate(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RotateDeviceKeyInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_DEVICE_ROTATE_KEY', { id, ...dto }, () => this.registry.rotateKey(req.user, id, dto));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('devices/:id/status')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  status(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeviceStatusInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_DEVICE_STATUS', { id, ...dto }, () => this.registry.setStatus(req.user, id, dto));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('cycles/:id/readings')
  @ApiDataResponse(WorkspaceRecordDto)
  cycleReadings(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() q: CycleReadingsQuery) {
    return this.registry.cycleReadings(req.user, id, q.hours);
  }

  /** Signed by the device key (Ed25519 over domain || 0x00 || RFC 8785 body). */
  @Post('ingest/readings')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Device-Signature', required: true })
  @ApiDataResponse(DeviceIngestResultDto)
  readings(@Body() dto: SignedReadingsInput, @Headers('x-device-signature') signature?: string) {
    return this.ingest.readings(dto, signature);
  }

  /** Signed like ingest; tells the device its asset and current trip. */
  @Post('device/assignment')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Device-Signature', required: true })
  @ApiDataResponse(DeviceAssignmentDto)
  assignment(@Body() dto: DeviceAssignmentInput, @Headers('x-device-signature') signature?: string) {
    return this.ingest.assignment(dto, signature);
  }

  @Post('ingest/positions')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Device-Signature', required: true })
  @ApiDataResponse(DeviceIngestResultDto)
  positions(@Body() dto: SignedPositionsInput, @Headers('x-device-signature') signature?: string) {
    return this.ingest.positions(dto, signature);
  }
}
