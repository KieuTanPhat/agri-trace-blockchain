import { FARM_WRITE_ROLES } from '../auth/business-write.policy.js';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Param,
  ParseUUIDPipe,
  type PipeTransform,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags,ApiProduces,ApiOkResponse } from '@nestjs/swagger';
import type {Response} from 'express';
import {Throttle} from '@nestjs/throttler';
import {PublicJourneyService} from './public-journey.service.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  CommandPolicy,
  CommandRecoveryRead,
} from '../auth/command-policy.decorator.js';
import { RecordHarvestDto } from './dto.js';
import { LotHarvestService } from './lot-harvest.service.js';
import { LotQueryService } from './lot-query.service.js';
import { HarvestRequestStatusService } from './harvest-request-status.service.js';
import { HarvestRequestStatusDto } from './harvest-request-status.dto.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import {
  DashboardDto,
  HarvestResultDto,
  InternalLotDto,
  PublicLotDto,
} from './lot-response.dto.js';

/** Printed trace tokens are URL-safe and short; anything else is not a QR. */
class ParseTraceTokenPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value))
      throw new BadRequestException('Mã truy xuất không hợp lệ');
    return value;
  }
}

@ApiTags('lots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
@CommandPolicy()
export class LotsController {
  constructor(
    private readonly harvests: LotHarvestService,
    private readonly query: LotQueryService,
    private readonly idempotency: IdempotencyService,
    private readonly harvestStatus: HarvestRequestStatusService,
  ) {}
  @Roles(...FARM_WRITE_ROLES)
  @CommandRecoveryRead()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Header('Cache-Control', 'no-store')
  @Get('production-cycles/:cycleId/harvest-request-status')
  @ApiDataResponse(HarvestRequestStatusDto)
  getHarvestStatus(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.harvestStatus.get(cycleId, key, req.user);
  }

  @Roles(...FARM_WRITE_ROLES)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('production-cycles/:cycleId/harvests')
  @ApiDataResponse(HarvestResultDto, 201)
  harvest(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Body() dto: RecordHarvestDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idempotency.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'RECORD_HARVEST',
        requestType: 'COMMAND',
        payload: { cycleId, ...dto },
      },
      () => this.harvests.recordHarvest(cycleId, dto, req.user),
    );
  }

  @Get('dashboard')
  @ApiDataResponse(DashboardDto)
  dashboard(@Req() req: AuthenticatedRequest) {
    return this.query.getDashboard(req.user);
  }

  @Get('lots')
  @ApiDataResponse(InternalLotDto, 200, true)
  getLots(@Req() req: AuthenticatedRequest) {
    return this.query.getList(req.user);
  }

  @Get('lots/by-trace-token/:token')
  @ApiDataResponse(InternalLotDto)
  getLotByTraceToken(
    @Param('token', new ParseTraceTokenPipe()) token: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.query.getInternalByTraceToken(token, req.user);
  }

  @Get('lots/:lotId')
  @ApiDataResponse(InternalLotDto)
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
  constructor(private readonly query: LotQueryService,private readonly journey:PublicJourneyService) {}
  @Get(':token/thumbnail') @Throttle({default:{limit:240,ttl:60000}}) @Header('Cache-Control','no-store')
  @ApiProduces('image/jpeg','image/png') @ApiOkResponse({schema:{type:'string',format:'binary'}})
  async thumbnail(@Param('token',new ParseTraceTokenPipe()) token:string,@Res() response:Response){const file=await this.journey.image(token);response.setHeader('X-Content-Type-Options','nosniff');response.type(file.mediaType).send(Buffer.from(file.content));}
  @Get(':token/media/:id') @Throttle({default:{limit:240,ttl:60000}}) @Header('Cache-Control','no-store')
  @ApiProduces('image/jpeg','image/png') @ApiOkResponse({schema:{type:'string',format:'binary'}})
  async media(@Param('token',new ParseTraceTokenPipe()) token:string,@Param('id',ParseUUIDPipe) id:string,@Res() response:Response){const file=await this.journey.image(token,id);response.setHeader('X-Content-Type-Options','nosniff');response.type(file.mediaType).send(Buffer.from(file.content));}
  @Header('Cache-Control', 'no-store')
  @Get(':token')
  @ApiDataResponse(PublicLotDto)
  get(@Param('token', new ParseTraceTokenPipe()) token: string) {
    return this.query.getPublic(token);
  }
}
