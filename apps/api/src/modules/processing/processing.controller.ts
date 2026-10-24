import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ProcessingService } from './processing.service.js';
import {
  CancelProcessingInput,
  CreateProcessingRunInput,
  CreateUnitConversionInput,
  LotLineageDto,
  ProcessingListDto,
  ProcessingQuery,
  ProcessingRecordDto,
  ProcessingVersionInput,
  RevokeUnitConversionInput,
  UnitConversionQuery,
} from './processing.dto.js';

const KEY = { name: 'Idempotency-Key', required: true } as const;

/** Processing (transformation) runs of a processor organization. */
@ApiTags('processing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('processing-runs')
export class ProcessingController {
  constructor(
    private readonly service: ProcessingService,
    private readonly idem: IdempotencyService,
  ) {}

  private command<T>(req: AuthenticatedRequest, key: string, operation: string, payload: object, work: () => Promise<T>) {
    return this.idem.executeCommand(
      { idempotencyKey: key, requesterId: req.user.sub, actor: req.user, responseStatus: 201, operation, requestType: 'COMMAND', payload },
      work,
    );
  }

  @Get()
  @ApiDataResponse(ProcessingListDto)
  list(@Req() req: AuthenticatedRequest, @Query() query: ProcessingQuery) {
    return this.service.list(req.user, query);
  }

  @Get('materials')
  @ApiDataResponse(ProcessingListDto)
  materials(@Req() req: AuthenticatedRequest) {
    return this.service.materials(req.user);
  }

  @Get('lineage/:lotId')
  @ApiDataResponse(LotLineageDto)
  lineage(@Req() req: AuthenticatedRequest, @Param('lotId', ParseUUIDPipe) lotId: string) {
    return this.service.lineage(req.user, lotId);
  }

  @Get('unit-conversions')
  @ApiDataResponse(ProcessingListDto)
  conversions(@Req() req: AuthenticatedRequest, @Query() query: UnitConversionQuery) {
    return this.service.conversions(req.user, query.productId);
  }

  @Post('unit-conversions')
  @ApiHeader(KEY)
  @ApiDataResponse(ProcessingRecordDto, 201)
  createConversion(@Req() req: AuthenticatedRequest, @Body() input: CreateUnitConversionInput, @IdempotencyKey() key: string) {
    return this.command(req, key, 'EW_UNIT_CONVERSION_CREATE', input, () => this.service.createConversion(req.user, input));
  }

  @Post('unit-conversions/:id/revoke')
  @ApiHeader(KEY)
  @ApiDataResponse(ProcessingRecordDto, 201)
  revokeConversion(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RevokeUnitConversionInput,
    @IdempotencyKey() key: string,
  ) {
    return this.command(req, key, 'EW_UNIT_CONVERSION_REVOKE', { ...input, id }, () => this.service.revokeConversion(req.user, id, input));
  }

  @Get(':id')
  @ApiDataResponse(ProcessingRecordDto)
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(req.user, id);
  }

  @Post()
  @ApiHeader(KEY)
  @ApiDataResponse(ProcessingRecordDto, 201)
  create(@Req() req: AuthenticatedRequest, @Body() input: CreateProcessingRunInput, @IdempotencyKey() key: string) {
    return this.command(req, key, 'EW_PROCESSING_CREATE', input, () => this.service.create(req.user, input));
  }

  @Post(':id/complete')
  @ApiHeader(KEY)
  @ApiDataResponse(ProcessingRecordDto, 201)
  complete(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ProcessingVersionInput,
    @IdempotencyKey() key: string,
  ) {
    return this.command(req, key, 'EW_PROCESSING_COMPLETE', { ...input, id }, () => this.service.complete(req.user, id, input));
  }

  @Post(':id/cancel')
  @ApiHeader(KEY)
  @ApiDataResponse(ProcessingRecordDto, 201)
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CancelProcessingInput,
    @IdempotencyKey() key: string,
  ) {
    return this.command(req, key, 'EW_PROCESSING_CANCEL', { ...input, id }, () => this.service.cancel(req.user, id, input));
  }
}
