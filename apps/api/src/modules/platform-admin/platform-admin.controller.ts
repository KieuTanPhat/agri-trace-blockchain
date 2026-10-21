import {
  Body,
  ConflictException,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { lockPlatformAudit } from '../platform-governance/platform-audit.js';
import { APPROVAL_REQUIRED_MESSAGE, approvalsMode } from '../platform-governance/platform-config.js';
import { AdminInsightsService } from './admin-insights.service.js';
import { blockQrTx, changeSettingTx, unblockQrTx } from './admin-controls.js';
import { SupportService } from './support.service.js';
import {
  AdminListDto,
  AdminRecordDto,
  BlockQrInput,
  ConsumerReportInput,
  DirectoryQuery,
  LedgerTxQuery,
  LotSearchQuery,
  NoticeInput,
  ReferenceItemInput,
  ReferenceQuery,
  ReportQuery,
  ReportReceiptDto,
  ReportTriageInput,
  SettingChangeInput,
  TicketAssignInput,
  TicketCloseInput,
  TicketCreateInput,
  TicketQuery,
  TicketReplyInput,
  TraceReportQuery,
  VersionReasonInput,
} from './platform-admin.dto.js';

const KEY = { name: 'Idempotency-Key', required: true } as const;
const READERS = ['SYSTEM_ADMIN', 'AUDITOR', 'PLATFORM_OPERATOR'] as const;
const CASE_STAFF = ['SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER'] as const;

abstract class Commands {
  constructor(protected readonly idem: IdempotencyService) {}
  protected command<T>(req: AuthenticatedRequest, key: string, operation: string, payload: object, work: () => Promise<T>) {
    return this.idem.executeCommand(
      { idempotencyKey: key, requesterId: req.user.sub, actor: req.user, responseStatus: 201, operation, requestType: 'COMMAND', payload },
      work,
    );
  }
}

/** Platform administration console. Reads aggregate across organizations;
 * every write is a journaled, audited command and never touches lots,
 * custody or quantities on behalf of an enterprise. */
@ApiTags('platform-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('platform-admin')
export class PlatformAdminController extends Commands {
  constructor(
    private readonly insights: AdminInsightsService,
    private readonly support: SupportService,
    private readonly db: PrismaService,
    idem: IdempotencyService,
  ) {
    super(idem);
  }

  @Roles(...READERS) @Get('dashboard') @ApiDataResponse(AdminRecordDto)
  async dashboard() { return { record: await this.insights.dashboard() }; }

  @Roles(...READERS, 'PLATFORM_CASE_MANAGER') @Get('inbox') @ApiDataResponse(AdminRecordDto)
  async inbox() { return { record: await this.insights.inbox() }; }

  @Roles(...READERS) @Get('organizations') @ApiDataResponse(AdminListDto)
  directory(@Query() query: DirectoryQuery) { return this.insights.directory(query); }

  @Roles(...READERS) @Get('organizations/:id') @ApiDataResponse(AdminRecordDto)
  async organization(@Param('id', ParseUUIDPipe) id: string) { return { record: await this.insights.organization(id) }; }

  @Roles(...READERS) @Get('chains') @ApiDataResponse(AdminListDto)
  chains() { return this.insights.chains(); }

  @Roles(...READERS, 'PLATFORM_CASE_MANAGER') @Get('lots') @ApiDataResponse(AdminListDto)
  lots(@Query() query: LotSearchQuery) { return this.insights.searchLots(query); }

  @Roles(...READERS, 'PLATFORM_CASE_MANAGER') @Get('lots/:id/lineage') @ApiDataResponse(AdminRecordDto)
  async lineage(@Param('id', ParseUUIDPipe) id: string) { return { record: await this.insights.lotLineage(id) }; }

  @Roles(...READERS) @Get('qr') @ApiDataResponse(AdminRecordDto)
  async qr() { return { record: await this.insights.qrOverview() }; }

  @Roles(...READERS) @Get('trace-report') @ApiDataResponse(AdminRecordDto)
  async traceReport(@Query() query: TraceReportQuery) { return { record: await this.insights.traceReport(query) }; }

  @Roles(...READERS) @Get('ledger') @ApiDataResponse(AdminRecordDto)
  async ledger() { return { record: await this.insights.ledgerOverview() }; }

  @Roles(...READERS) @Get('ledger/transactions') @ApiDataResponse(AdminListDto)
  ledgerTransactions(@Query() query: LedgerTxQuery) { return this.insights.ledgerTransactions(query.status, query.q); }

  @Roles(...READERS) @Get('statistics') @ApiDataResponse(AdminRecordDto)
  async statistics() { return { record: await this.insights.statistics() }; }

  @Roles(...READERS) @Get('monitoring') @ApiDataResponse(AdminRecordDto)
  async monitoring() { return { record: await this.insights.monitoring() }; }

  @Roles('SYSTEM_ADMIN', 'AUDITOR') @Get('security') @ApiDataResponse(AdminRecordDto)
  async security() { return { record: await this.insights.securityAlerts() }; }

  @Roles(...READERS) @Get('backup') @ApiDataResponse(AdminRecordDto)
  async backup() { return { record: await this.insights.backupStatus() }; }

  @Roles('SYSTEM_ADMIN', 'AUDITOR') @Get('settings') @ApiDataResponse(AdminListDto)
  settings() { return this.insights.settings(); }

  @Roles('SYSTEM_ADMIN') @Post('settings/:key') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  changeSetting(@Param('key') key: string, @Body() input: SettingChangeInput, @IdempotencyKey() idemKey: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, idemKey, 'PLATFORM_SETTING_CHANGE', { ...input, key }, () => {
      if (approvalsMode() === 'ENFORCED') throw new ConflictException(APPROVAL_REQUIRED_MESSAGE);
      return commandTransaction(this.db, async (tx) => {
        await lockPlatformAudit(tx);
        const row = await changeSettingTx(tx, req.user, { key, value: input.value, version: input.version, reason: input.reason });
        return { record: { key: row.key, value: row.value, version: row.version } };
      });
    });
  }

  @Roles('SYSTEM_ADMIN') @Post('qr-blocks') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  blockQr(@Body() input: BlockQrInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_QR_BLOCK', input, () => {
      if (approvalsMode() === 'ENFORCED') throw new ConflictException(APPROVAL_REQUIRED_MESSAGE);
      return commandTransaction(this.db, async (tx) => {
        await lockPlatformAudit(tx);
        const row = await blockQrTx(tx, req.user, input);
        return { record: { id: row.id, lotId: row.lotId } };
      });
    });
  }

  @Roles('SYSTEM_ADMIN') @Post('qr-blocks/:id/unblock') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  unblockQr(@Param('id', ParseUUIDPipe) id: string, @Body() input: VersionReasonInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_QR_UNBLOCK', { ...input, id }, () =>
      commandTransaction(this.db, async (tx) => {
        await lockPlatformAudit(tx);
        const row = await unblockQrTx(tx, req.user, { blockId: id, version: input.version, reason: input.reason });
        return { record: { id: row.id } };
      }),
    );
  }

  @Roles(...READERS) @Get('notices') @ApiDataResponse(AdminListDto)
  notices() { return this.support.notices(); }

  @Roles('SYSTEM_ADMIN') @Post('notices') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  publishNotice(@Body() input: NoticeInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_NOTICE_PUBLISH', input, () => this.support.publishNotice(req.user, input));
  }

  @Roles('SYSTEM_ADMIN') @Post('notices/:id/withdraw') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  withdrawNotice(@Param('id', ParseUUIDPipe) id: string, @Body() input: VersionReasonInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_NOTICE_WITHDRAW', { ...input, id }, () => this.support.withdrawNotice(req.user, id, input));
  }

  @Roles(...READERS) @Get('reference-items') @ApiDataResponse(AdminListDto)
  references(@Query() query: ReferenceQuery) { return this.support.referenceItems(query.category, true); }

  @Roles('SYSTEM_ADMIN') @Post('reference-items') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  upsertReference(@Body() input: ReferenceItemInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_REFERENCE_UPSERT', input, () => this.support.upsertReference(req.user, input));
  }

  @Roles(...CASE_STAFF, 'AUDITOR') @Get('tickets') @ApiDataResponse(AdminListDto)
  tickets(@Query() query: TicketQuery) { return this.support.tickets(query); }

  @Roles(...CASE_STAFF) @Get('support-staff') @ApiDataResponse(AdminListDto)
  staff() { return this.support.staff(); }

  @Roles(...CASE_STAFF) @Post('tickets/:id/assign') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() input: TicketAssignInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_TICKET_ASSIGN', { ...input, id }, () => this.support.assignTicket(req.user, id, input));
  }

  @Roles(...CASE_STAFF) @Post('tickets/:id/reply') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  reply(@Param('id', ParseUUIDPipe) id: string, @Body() input: TicketReplyInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_TICKET_REPLY', { ...input, id }, () => this.support.replyAsPlatform(req.user, id, input));
  }

  @Roles(...CASE_STAFF) @Post('tickets/:id/close') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() input: TicketCloseInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_TICKET_CLOSE', { ...input, id }, () => this.support.closeTicket(req.user, id, input));
  }

  @Roles(...CASE_STAFF, 'AUDITOR') @Get('consumer-reports') @ApiDataResponse(AdminListDto)
  reports(@Query() query: ReportQuery, @Req() req: AuthenticatedRequest) {
    return this.support.reports(query, (CASE_STAFF as readonly string[]).includes(req.user.role));
  }

  @Roles(...CASE_STAFF) @Post('consumer-reports/:id/triage') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  triage(@Param('id', ParseUUIDPipe) id: string, @Body() input: ReportTriageInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'PLATFORM_REPORT_TRIAGE', { ...input, id }, () => this.support.triageReport(req.user, id, input));
  }
}

@ApiTags('enterprise-support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enterprise-support')
export class EnterpriseSupportController extends Commands {
  constructor(private readonly support: SupportService, idem: IdempotencyService) {
    super(idem);
  }
  @Get('tickets') @ApiDataResponse(AdminListDto)
  mine(@Req() req: AuthenticatedRequest) { return this.support.myTickets(req.user); }

  @Post('tickets') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  create(@Body() input: TicketCreateInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'EW_TICKET_CREATE', input, () => this.support.createTicket(req.user, input));
  }

  @Post('tickets/:id/reply') @ApiHeader(KEY) @ApiDataResponse(AdminRecordDto, 201)
  reply(@Param('id', ParseUUIDPipe) id: string, @Body() input: TicketReplyInput, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.command(req, key, 'EW_TICKET_REPLY', { ...input, id }, () => this.support.replyAsEnterprise(req.user, id, input));
  }
}

@ApiTags('system-notices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('system-notices')
export class SystemNoticesController {
  constructor(private readonly support: SupportService) {}
  @Get('active') @ApiDataResponse(AdminListDto)
  active(@Req() req: AuthenticatedRequest) { return this.support.activeNotices(req.user); }
}

@ApiTags('reference-data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reference-data')
export class ReferenceItemsController {
  constructor(private readonly support: SupportService) {}
  @Get('items') @ApiDataResponse(AdminListDto)
  items(@Query() query: ReferenceQuery) { return this.support.referenceItems(query.category); }
}

/** Public report from a product's QR page. Throttled per client and per lot. */
@ApiTags('public-trace')
@Controller('public/trace')
export class PublicReportsController {
  constructor(private readonly support: SupportService) {}
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':token/reports')
  @ApiHeader({ ...KEY, description: 'Trùng với requestId trong nội dung để gửi lại an toàn' })
  @ApiDataResponse(ReportReceiptDto, 201)
  report(@Param('token') token: string, @Body() input: ConsumerReportInput, @IdempotencyKey() key: string, @Ip() ip: string) {
    if (key !== input.requestId) throw new ConflictException('Idempotency-Key phải trùng requestId');
    return this.support.submitReport(token, input, ip ?? 'unknown');
  }
}
