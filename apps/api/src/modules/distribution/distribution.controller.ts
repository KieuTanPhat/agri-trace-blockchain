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
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  WorkspaceListDto,
  WorkspaceRecordDto,
} from '../enterprise-workspace/dto.js';
import {
  DistributionChallengeDto,
  DistributionReportDto,
  TransferInput,
  TransferKeyInput,
  TransferSignature,
  TransferVersion,
  TransferObservationInput,
  TraceNoticeInput,
  HoldingDispositionInput,
  DistributionOptionsDto,
  SiteAllocationInput, QuarantineInput, ActualReceiptInput, ReturnInput, ReturnSignatureInput,
  DistributionC2Prepare,DistributionC2Submit,
  ConsentRenewInput,
  DistributionReportQuery,
  DistributionTasksDto,
} from './dto.js';
import { DistributionService } from './distribution.service.js';
@ApiTags('distribution')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('distribution')
export class DistributionController {
  constructor(
    private readonly service: DistributionService,
    private readonly idem: IdempotencyService,
  ) {}
  private run(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: unknown,
    fn: () => Promise<unknown>,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation,
        payload,
        requestType: 'COMMAND',
      },
      fn,
    );
  }
  @Post('quantities')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  disposition(
    @Req() req: AuthenticatedRequest,
    @Body() dto: HoldingDispositionInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_DISPOSITION', dto, () =>
      this.service.disposition(req.user, dto),
    );
  }
  @Get('transfers') @ApiDataResponse(WorkspaceListDto) list(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.list(req.user);
  }
  @Post('transfers/:id/c2/prepare') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceListDto,201)
  prepareC2(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:DistributionC2Prepare,@IdempotencyKey() key:string){return this.run(req,key,'DIST_C2_PREPARE',{id,...dto},()=>this.service.prepareC2(req.user,id,dto));}
  @Post('transfers/:id/c2/submit') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
  submitC2(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:DistributionC2Submit,@IdempotencyKey() key:string){return this.run(req,key,'DIST_C2_SUBMIT',{id,...dto},()=>this.service.submitC2(req.user,id,dto));}
  @Post('transfers/:id/consent-renewal') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
  renewConsent(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ConsentRenewInput,@IdempotencyKey() key:string){return this.run(req,key,'DIST_RENEW_CONSENT',{id,...dto},()=>this.service.renewConsent(req.user,id,dto));}
  @Post('allocations') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  allocate(@Req() req: AuthenticatedRequest, @Body() dto: SiteAllocationInput, @IdempotencyKey() key: string) {
    return this.run(req,key,'EW_ALLOCATE',dto,() => this.service.allocate(req.user,dto));
  }
  @Post('quarantine') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  quarantine(@Req() req: AuthenticatedRequest, @Body() dto: QuarantineInput, @IdempotencyKey() key: string) {
    return this.run(req,key,'EW_QUARANTINE',dto,() => this.service.quarantine(req.user,dto));
  }
  @Post('transfers/:id/receipt') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  receipt(@Req() req: AuthenticatedRequest, @Param('id',ParseUUIDPipe) id: string, @Body() dto: ActualReceiptInput, @IdempotencyKey() key: string) {
    return this.run(req,key,'DIST_RECEIPT',{id,...dto},() => this.service.actualReceipt(req.user,id,dto));
  }
  @Post('transfers/:id/returns') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  proposeReturn(@Req() req: AuthenticatedRequest, @Param('id',ParseUUIDPipe) id: string, @Body() dto: ReturnInput, @IdempotencyKey() key: string) {
    return this.run(req,key,'DIST_RETURN',{id,...dto},() => this.service.proposeReturn(req.user,id,dto));
  }
  @Post('transfers/:id/returns/:returnId/sign') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  signReturn(@Req() req: AuthenticatedRequest, @Param('id',ParseUUIDPipe) id: string, @Param('returnId',ParseUUIDPipe) returnId: string, @Body() dto: ReturnSignatureInput, @IdempotencyKey() key: string) {
    return this.run(req,key,'DIST_RETURN_SIGN',{id,returnId,...dto},() => this.service.signReturn(req.user,id,returnId,dto));
  }
  @Get('options') @ApiDataResponse(DistributionOptionsDto) options(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.options(req.user);
  }
  @Get('reports') @ApiDataResponse(DistributionReportDto) report(
    @Req() req: AuthenticatedRequest,
    @Query() query:DistributionReportQuery,
  ) {
    return this.service.report(req.user,'reports.read',query);
  }
  @Get('qr') @ApiDataResponse(DistributionReportDto) qr(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.report(req.user, 'qr.manage');
  }
  @Get('tasks') @ApiDataResponse(DistributionTasksDto) tasks(@Req() req: AuthenticatedRequest) {
    return this.service.tasks(req.user);
  }
  @Get('keys') @ApiDataResponse(WorkspaceListDto) keys(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.keys(req.user);
  }
  @Get('transfers/:id') @ApiDataResponse(WorkspaceRecordDto) detail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(req.user, id);
  }
  @Get('transfers/:id/challenge')
  @ApiDataResponse(DistributionChallengeDto)
  challenge(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.challenge(req.user, id);
  }
  @Post('transfers')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TransferInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'DIST_CREATE', dto, () =>
      this.service.create(req.user, dto),
    );
  }
  @Post('transfers/:id/sign')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  sign(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferSignature,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'DIST_SIGN', { id, ...dto }, () =>
      this.service.sign(req.user, id, dto),
    );
  }
  @Post('transfers/:id/cancel')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferVersion,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'DIST_CANCEL', { id, ...dto }, () =>
      this.service.cancel(req.user, id, dto),
    );
  }
  @Post('keys')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  key(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TransferKeyInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_REGISTER_DISTRIBUTION_KEY', dto, () =>
      this.service.registerKey(req.user, dto),
    );
  }
  @Post('keys/:id/revoke')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  revokeKey(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_REVOKE_DISTRIBUTION_KEY', { id }, () =>
      this.service.revokeKey(req.user, id),
    );
  }
  @Post('notices')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  notice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TraceNoticeInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_TRACE_NOTICE', dto, () =>
      this.service.notice(req.user, dto),
    );
  }
  @Post('transfers/:id/journal')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  observe(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferObservationInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'DIST_OBSERVE', { id, ...dto }, () =>
      this.service.observe(req.user, id, dto),
    );
  }
}
