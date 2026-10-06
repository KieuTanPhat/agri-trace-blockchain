import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ActivityReportQueryDto } from './dto.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  'SYSTEM_ADMIN',
  'FARM_STAFF',
  'TRANSPORTER',
  'RETAILER',
  'AUDITOR',
)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
  ) {}

  @Get('activity')
  getActivityReport(
    @Query() query: ActivityReportQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getActivityReport(
      query,
      request.user,
    );
  }

  @Get('activity/summary')
  getActivitySummary(
    @Query() query: ActivityReportQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getActivityReport(
      query,
      request.user,
    );
  }

  @Get('activity/timeline')
  getActivityTimeline(
    @Query() query: ActivityReportQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getActivityReport(
      query,
      request.user,
    );
  }
}