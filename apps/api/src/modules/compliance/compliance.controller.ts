import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ComplianceService } from './compliance.service.js';
import { CreateCertificateDto, CreateInspectionDto } from './dto.js';

@ApiTags('compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ComplianceController {
  constructor(
    private readonly service: ComplianceService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR')
  @Get('inspections')
  inspections(
    @Req() request: AuthenticatedRequest,
    @Query('lotId') lotId?: string,
  ) {
    return this.service.listInspections(request.user, lotId);
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('inspections')
  createInspection(
    @Body() input: CreateInspectionDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId: request.user.sub,
        operation: 'CREATE_INSPECTION',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.createInspection(input, request.user),
    );
  }

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR')
  @Get('certificates')
  certificates(
    @Req() request: AuthenticatedRequest,
    @Query('lotId') lotId?: string,
    @Query('cycleId') cycleId?: string,
  ) {
    return this.service.listCertificates(request.user, lotId, cycleId);
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('certificates')
  createCertificate(
    @Body() input: CreateCertificateDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId: request.user.sub,
        operation: 'CREATE_CERTIFICATE',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.createCertificate(input, request.user),
    );
  }
}
