import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AlertScannerService } from './alert-scanner.service.js';
import {
  CreateSensorAlertRuleDto,
  ListNotificationsQueryDto,
  UpdateSensorAlertRuleDto,
} from './dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly scanner: AlertScannerService,
  ) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.listNotifications(request.user, query);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.markRead(id, request.user);
  }

  @Patch(':id/resolve')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.resolve(id, request.user);
  }

  @Roles('SYSTEM_ADMIN')
  @Post('scan')
  scan() {
    return this.scanner.scan();
  }
}

@ApiTags('alert-rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alert-rules')
export class AlertRulesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('organizationId', new ParseUUIDPipe({ optional: true })) organizationId?: string,
  ) {
    return this.notifications.listRules(request.user, organizationId);
  }

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @Post()
  create(
    @Body() input: CreateSensorAlertRuleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.createRule(input, request.user);
  }

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateSensorAlertRuleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.updateRule(id, input, request.user);
  }
}
