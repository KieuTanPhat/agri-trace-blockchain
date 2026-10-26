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
  'EW_PROFILE_CONTACT','EW_PROFILE_SUBMIT','EW_PROFILE_WITHDRAW','ENTERPRISE_PROFILE_REVIEW',
  'PRIVACY_REQUEST_CREATE',
  'PLATFORM_PRIVACY_BREACH_CREATE',
  'PLATFORM_PRIVACY_UPDATE',
  'EW_CREATE_MEMBER',
  'EW_INVITE_MEMBER','EW_REVOKE_MEMBER_INVITATION',
  'EW_UPDATE_MEMBER','EW_CHANGE_MEMBER_SUPERVISOR',
  'EW_CREATE_ROLE',
  'EW_UPDATE_ROLE',
  'EW_DELETE_ROLE',
  'EW_INVITE_PARTNER',
  'EW_CREATE_EXTERNAL_PARTNER',
  'EW_RESOLVE_PARTNER',
  'EW_CREATE_SITE',
  'EW_COMPLETE_SITE',
  'EW_UPDATE_SITE',
  'EW_CREATE_VEHICLE',
  'EW_UPDATE_VEHICLE',
  'EW_CREATE_PRODUCT',
  'EW_UPDATE_PRODUCT', 'EW_REVISE_SITE', 'EW_REVISE_VEHICLE',
  'EW_CREATE_MATERIAL','EW_UPDATE_MATERIAL','EW_IMPORT_PRODUCTS','EW_UPLOAD_EVIDENCE','EW_WITHDRAW_EVIDENCE','EW_ORDER_PRODUCT_PHOTOS',
  'EW_COMPLETE_MATERIAL',
  'EW_ALLOCATE','EW_QUARANTINE','EW_CASE_ACK','EW_CASE_RESPOND',
  'EW_MESSAGE_SEND','EW_MESSAGE_REPLY','EW_MESSAGE_READ',
  'EW_SITE_TRANSFER_CREATE','EW_SITE_TRANSFER_DISPATCH','EW_SITE_TRANSFER_RECEIVE','EW_SITE_TRANSFER_RESOLVE','EW_SITE_TRANSFER_CANCEL',
  'EW_PICKUP_REQUEST','EW_PICKUP_DECLINE','EW_PICKUP_CANCEL','DIST_JOIN_CHAIN',
  'DIST_RECEIPT','DIST_RETURN','DIST_RETURN_SIGN','DIST_RENEW_CONSENT','DIST_C2_PREPARE','DIST_C2_SUBMIT',
  'EW_CREATE_FARM',
  'EW_COMPLETE_FARM',
  'EW_COMPLETE_PRODUCT',
  'EW_CREATE_PLOT',
  'EW_REGISTER_DISTRIBUTION_KEY',
  'EW_REVOKE_DISTRIBUTION_KEY',
  'DIST_CREATE',
  'DIST_SIGN',
  'DIST_CANCEL',
  'DIST_OBSERVE',
  'EW_TRACE_NOTICE',
  'EW_DISPOSITION',
  'ENTERPRISE_REVIEW',
  'ENTERPRISE_ACTIVATE',
  'ENTERPRISE_CONNECT',
  'ENTERPRISE_CONNECTION_REVIEW',
  'CREATE_PRODUCTION_CYCLE',
  'EW_CREATE_CYCLE_DRAFT',
  'EW_LINK_CYCLE_DRAFT',
  'EW_SET_CYCLE_STAFF',
  'PLANT_PRODUCTION_CYCLE',
  'RECORD_CARE',
  'RECORD_SENSOR',
  'INGEST_SENSOR_READING',
  'INGEST_SHIPMENT_TELEMETRY',
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
  'BIND_SHIPMENT_DEVICE',
  'UNBIND_SHIPMENT_DEVICE',
  'CREATE_SHIPMENT_TELEMETRY_DIGEST',
  'HYB_CREATE_CHAIN',
  'HYB_ACTIVATE_BUSINESS_PROFILE',
  'HYB_SUSPEND_BUSINESS_PROFILE',
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
  'PREPARE_HANDOVER_OFFER',
  'PREPARE_HANDOVER_CONFIRM',
  'SUBMIT_SIGNED_INTENT',
  'REJECT_HANDOVER',
  'CANCEL_HANDOVER',
  'HYB_REGISTER_SIGNING_KEY',
  'HYB_REVOKE_SIGNING_KEY',
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
