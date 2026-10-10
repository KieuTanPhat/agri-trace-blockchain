import {
  FARM_WRITE_ROLES,
  COMPLIANCE_REVIEW_ROLES,
} from '../auth/business-write.policy.js';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ComplianceService } from './compliance.service.js';
import {
  CreateCertificateDto,
  CreateInspectionDto,
  ReviewCertificateDto,
} from './dto.js';

@ApiTags('compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ComplianceController {
  constructor(
    private readonly service: ComplianceService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Roles(
    'SYSTEM_ADMIN',
    'FARM_STAFF',
    'TRANSPORTER',
    'RETAILER',
    'AUDITOR',
    'COMPLIANCE_REVIEWER',
  )
  @Get('inspections')
  inspections(
    @Req() request: AuthenticatedRequest,
    @Query('lotId', new ParseUUIDPipe({ optional: true })) lotId?: string,
  ) {
    return this.service.listInspections(request.user, lotId);
  }

  @Roles(...COMPLIANCE_REVIEW_ROLES)
  @ApiForbiddenResponse({
    description:
      'AGT-026: chưa phê duyệt vai trò ghi inspection; endpoint chỉ từ chối ghi.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('inspections')
  createInspection(
    @Body() input: CreateInspectionDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: request.user.sub,
        actor: request.user,
        responseStatus: 201,
        operation: 'CREATE_INSPECTION',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.createInspection(input, request.user),
    );
  }

  @Roles(
    'SYSTEM_ADMIN',
    'FARM_STAFF',
    'TRANSPORTER',
    'RETAILER',
    'AUDITOR',
    'COMPLIANCE_REVIEWER',
  )
  @Get('certificates')
  certificates(
    @Req() request: AuthenticatedRequest,
    @Query('lotId', new ParseUUIDPipe({ optional: true })) lotId?: string,
    @Query('cycleId', new ParseUUIDPipe({ optional: true })) cycleId?: string,
  ) {
    return this.service.listCertificates(request.user, lotId, cycleId);
  }

  @Roles(...FARM_WRITE_ROLES)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('certificates')
  createCertificate(
    @Body() input: CreateCertificateDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: request.user.sub,
        actor: request.user,
        responseStatus: 201,
        operation: 'CREATE_CERTIFICATE',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.createCertificate(input, request.user),
    );
  }

  @Roles(...COMPLIANCE_REVIEW_ROLES)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Patch('certificates/:id/review')
  @ApiForbiddenResponse({
    description:
      'AGT-026: chưa phê duyệt reviewer; Admin/Auditor không ghi nghiệp vụ.',
  })
  reviewCertificate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReviewCertificateDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: request.user.sub,
        actor: request.user,
        responseStatus: 200,
        operation: 'REVIEW_CERTIFICATE',
        requestType: 'COMMAND',
        payload: { id, ...input },
      },
      () => this.service.reviewCertificate(id, input, request.user),
    );
  }
}
