import { ApiDataResponse } from '../../common/api/openapi.js';
import { ComplianceAssignmentRecordDto } from '../../common/api/record.dto.js';
import { AssignmentListDto } from '../../common/api/response.dto.js';
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
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ComplianceAssignmentsService } from './assignments.service.js';

export class AssignmentReasonDto {
  @ApiProperty({ maxLength: 1000, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
export class GrantAssignmentDto extends AssignmentReasonDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() reviewerUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() farmId!: string;
}

@ApiTags('compliance-assignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN')
@Controller('compliance/assignments')
export class ComplianceAssignmentsController {
  constructor(
    private readonly service: ComplianceAssignmentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @ApiDataResponse(AssignmentListDto, 200, true)
  @Get()
  @Roles('SYSTEM_ADMIN', 'COMPLIANCE_REVIEWER')
  list(@Req() req: AuthenticatedRequest) {
    return this.service.list(req.user);
  }

  @ApiDataResponse(ComplianceAssignmentRecordDto, 201)
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  grant(
    @Body() dto: GrantAssignmentDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        operation: 'GRANT_COMPLIANCE_ASSIGNMENT',
        requestType: 'COMMAND',
        payload: dto,
        responseStatus: 201,
      },
      () => this.service.grant(dto, req.user),
    );
  }

  @ApiDataResponse(ComplianceAssignmentRecordDto, 201)
  @Post(':id/revoke')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentReasonDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        operation: 'REVOKE_COMPLIANCE_ASSIGNMENT',
        requestType: 'COMMAND',
        payload: { id, ...dto },
        responseStatus: 201,
      },
      () => this.service.revoke(id, dto.reason, req.user),
    );
  }
}
