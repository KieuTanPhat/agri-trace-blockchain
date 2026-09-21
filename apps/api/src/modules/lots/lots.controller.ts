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
import { LotsService } from './lots.service.js';

@ApiTags('lots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class LotsController {
  constructor(
    private readonly service: LotsService,
    private readonly idempotency: IdempotencyService,
  ) {}
  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
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
      () => this.service.recordHarvest(cycleId, dto, req.user),
    );
  }
  @Get('lots/:lotId')
  getLot(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.getInternal(lotId, req.user);
  }
}

@ApiTags('public-trace')
@Controller('public/trace')
export class PublicTraceController {
  constructor(private readonly service: LotsService) {}
  @Get(':token') get(@Param('token') token: string) {
    return this.service.getPublic(token);
  }
}
