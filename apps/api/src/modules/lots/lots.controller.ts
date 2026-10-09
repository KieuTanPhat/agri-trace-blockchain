import { FARM_WRITE_ROLES } from '../auth/business-write.policy.js';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RecordHarvestDto } from './dto.js';
import { LotHarvestService } from './lot-harvest.service.js';
import { LotQueryService } from './lot-query.service.js';

@ApiTags('lots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class LotsController {
  constructor(
    private readonly harvests: LotHarvestService,
    private readonly query: LotQueryService,
    private readonly idempotency: IdempotencyService,
  ) {}
  @Roles(...FARM_WRITE_ROLES)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('production-cycles/:cycleId/harvests')
  harvest(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Body() dto: RecordHarvestDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        operation: 'RECORD_HARVEST',
        requestType: 'COMMAND',
        payload: { cycleId, ...dto },
      },
      () => this.harvests.recordHarvest(cycleId, dto, req.user),
    );
  }

  @Get('dashboard')
  dashboard(@Req() req: AuthenticatedRequest) {
    return this.query.getDashboard(req.user);
  }

  @Get('lots')
  getLots(@Req() req: AuthenticatedRequest) {
    return this.query.getList(req.user);
  }

  @Get('lots/:lotId')
  getLot(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.query.getInternal(lotId, req.user);
  }
}

@ApiTags('public-trace')
@Controller('public/trace')
export class PublicTraceController {
  constructor(private readonly query: LotQueryService) {}
  @Get(':token') get(@Param('token') token: string) {
    return this.query.getPublic(token);
  }
}
