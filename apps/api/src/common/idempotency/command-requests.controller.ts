import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsObject } from 'class-validator';
import { ApiDataResponse } from '../api/openapi.js';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../../modules/auth/auth.types.js';
import { IdempotencyService } from './idempotency.service.js';
import { IdempotencyKey } from './idempotency-key.decorator.js';

const operations = [
  'CREATE_PRODUCTION_CYCLE',
  'PLANT_PRODUCTION_CYCLE',
  'RECORD_CARE',
  'RECORD_SENSOR',
  'CLOSE_PRODUCTION_CYCLE',
  'CANCEL_PRODUCTION_CYCLE',
  'RECORD_HARVEST',
  'CREATE_SHIPMENT',
  'START_SHIPMENT',
  'ARRIVE_SHIPMENT',
  'RECEIVE_SHIPMENT',
  'REJECT_SHIPMENT',
  'DAMAGE_SHIPMENT',
  'DAMAGE_LOT',
  'MARK_FOR_SALE',
  'MARK_SOLD',
  'RECALL_LOT',
  'EXPIRE_LOT',
  'CREATE_INSPECTION',
  'CREATE_CERTIFICATE',
  'REVIEW_CERTIFICATE',
  'CREATE_SENSOR_DIGEST',
  'RECONCILE_CYCLE_SENSOR',
  'BIND_SHIPMENT_DEVICE',
  'UNBIND_SHIPMENT_DEVICE',
  'CREATE_SHIPMENT_TELEMETRY_DIGEST',
  'HYB_CREATE_CHAIN',
  'HYB_INVITE_MEMBERSHIP',
  'HYB_ACCEPT_MEMBERSHIP',
  'HYB_CHANGE_MEMBERSHIP',
  'HYB_GRANT_ROLE',
  'HYB_REVOKE_ROLE',
  'HYB_SET_CAPABILITY',
  'SCOPE_CREATE_SHIPMENT_PLAN',
  'SCOPE_REVISE_SHIPMENT_PLAN',
  'SCOPE_ACCEPT_SHIPMENT_PLAN',
  'SCOPE_CANCEL_SHIPMENT_PLAN',
  'SCOPE_FINALIZE_SHIPMENT_PLAN',
  'SCOPE_REGISTER_LEGACY_MANIFEST',
  'SCOPE_CONFIRM_LEGACY_ASSIGNMENT',
  'SCOPE_APPLY_LEGACY_ROOT',
] as const;

export class InspectCommandRequestDto {
  @ApiProperty({ enum: operations }) @IsIn(operations) operation!: string;
  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description:
      'Payload gốc của command, gồm resource IDs như controller chuẩn hóa',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
export class CommandRequestStatusDto {
  @ApiProperty({
    enum: [
      'NOT_FOUND',
      'PROCESSING',
      'COMMITTED',
      'REJECTED',
      'RECONCILIATION_REQUIRED',
    ],
  })
  status!: string;
  @ApiPropertyOptional({ type: Number }) responseStatus?: number;
  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    additionalProperties: true,
  })
  result?: unknown;
}

@ApiTags('command-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('command-requests')
export class CommandRequestsController {
  constructor(private readonly idem: IdempotencyService) {}
  @Post('status')
  @HttpCode(200)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Khóa yêu cầu gốc cần đối soát; không tạo command mới',
  })
  @ApiDataResponse(CommandRequestStatusDto)
  inspect(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InspectCommandRequestDto,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.inspectCommand({
      actor: req.user,
      requesterId: req.user.sub,
      operation: dto.operation,
      idempotencyKey: key,
      payload: dto.payload,
    });
  }
}
