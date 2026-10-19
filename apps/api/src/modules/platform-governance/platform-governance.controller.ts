import {
  Body,
  Controller,
  Get,
  Headers,
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
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  ApprovalListQueryDto,
  AuditQueryDto,
  CancelApprovalDto,
  DecideApprovalDto,
  EnrollMfaDto,
  MfaCodeDto,
  OperationsQueryDto,
  ProposeApprovalDto,
} from './dto.js';
import { PlatformApprovalsService } from './platform-approvals.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformOperationsService } from './platform-operations.service.js';
import { PlatformCasesService } from './platform-cases.service.js';
import {
  AssignCaseDto,
  CaseListQueryDto,
  CaseNoteDto,
  ClassifyCaseDto,
  CloseCaseDto,
  CreateCaseDto,
  EnterpriseCaseAckDto,
  EnterpriseCaseResponseDto,
  EscalateCaseDto,
  LinkCaseLotDto,
} from './case.dto.js';
import { PlatformMfaService } from './platform-mfa.service.js';
import {
  CredentialsOverviewDto,
  AdminSummaryDto,
  CaseOrganizationOptionDto,
  EnterpriseCaseDto,
  PlatformCaseDetailDto,
  PlatformCaseDto,
  PlatformCasePageDto,
  HealthPageDto,
  HoldPageDto,
  JobPageDto,
  MailPageDto,
  OperationsSummaryDto,
  OutboxPageDto,
  MfaDisabledDto,
  MfaEnabledDto,
  MfaEnrollmentDto,
  MfaStatusDto,
  PlatformApprovalDto,
  PlatformAuditExportDto,
  PlatformAuditPageDto,
  PlatformAuditVerificationDto,
} from './response.dto.js';

const MFA_HEADER = {
  name: 'X-MFA-Code',
  required: false,
  description:
    'Mã TOTP hoặc mã khôi phục. Bắt buộc cho quản trị viên đã bật MFA khi thực hiện thao tác rủi ro cao.',
} as const;

/** Read-only evidence for platform administration. AUDITOR may read but never
 * write; there is no mutation endpoint on this controller. */
@ApiTags('platform-audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'AUDITOR')
@Controller('platform-audit')
export class PlatformAuditController {
  constructor(private readonly service: PlatformAuditService) {}

  @ApiDataResponse(PlatformAuditPageDto)
  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.service.list(query);
  }

  @ApiDataResponse(PlatformAuditExportDto)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Get('export')
  exportCsv(@Query() query: AuditQueryDto) {
    return this.service.exportCsv(query);
  }

  // A full-chain scan: bounded separately from ordinary reads.
  @ApiDataResponse(PlatformAuditVerificationDto)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Get('verify')
  verify() {
    return this.service.verify();
  }

  @ApiDataResponse('string', 200, true)
  @Get('actions')
  actions() {
    return this.service.actions();
  }
}

// Under /auth so it follows the session endpoints' contract: these calls are
// self-service, return one-time secrets and therefore must never be stored in
// the idempotency journal.
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  'SYSTEM_ADMIN',
  'PLATFORM_OPERATOR',
  'PLATFORM_CASE_MANAGER',
  'PLATFORM_PRIVACY_OFFICER',
)
@Controller('auth/mfa')
export class PlatformMfaController {
  constructor(private readonly service: PlatformMfaService) {}

  @ApiDataResponse(MfaStatusDto)
  @Get()
  status(@Req() req: AuthenticatedRequest) {
    return this.service.status({ sub: req.user.sub, role: req.user.role });
  }

  @ApiDataResponse(MfaEnrollmentDto, 201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('enroll')
  enroll(@Req() req: AuthenticatedRequest, @Body() input: EnrollMfaDto) {
    return this.service.enroll(
      { sub: req.user.sub, role: req.user.role },
      req.user.email,
      input.currentPassword,
    );
  }

  @ApiDataResponse(MfaEnabledDto, 201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  verify(@Req() req: AuthenticatedRequest, @Body() input: MfaCodeDto) {
    return this.service.verifyEnrollment(
      { sub: req.user.sub, role: req.user.role },
      input.code,
    );
  }

  @ApiDataResponse(MfaDisabledDto, 201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('disable')
  disable(@Req() req: AuthenticatedRequest, @Body() input: MfaCodeDto) {
    return this.service.disable(
      { sub: req.user.sub, role: req.user.role },
      input.code,
    );
  }

  @ApiDataResponse(MfaEnabledDto, 201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('recovery-codes')
  recoveryCodes(@Req() req: AuthenticatedRequest, @Body() input: MfaCodeDto) {
    return this.service.regenerateRecoveryCodes(req.user, input.code);
  }
}

@ApiTags('platform-approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('platform-approvals')
export class PlatformApprovalsController {
  constructor(
    private readonly service: PlatformApprovalsService,
    private readonly idem: IdempotencyService,
  ) {}

  private command<T>(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: () => Promise<T>,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation,
        requestType: 'COMMAND',
        payload,
      },
      work,
    );
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR')
  @ApiDataResponse(PlatformApprovalDto, 200, true)
  @Get()
  list(@Query() query: ApprovalListQueryDto) {
    return this.service.list(query.status);
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR')
  @ApiDataResponse(PlatformApprovalDto)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Roles('SYSTEM_ADMIN')
  @ApiDataResponse(PlatformApprovalDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader(MFA_HEADER)
  @Post()
  propose(
    @Body() input: ProposeApprovalDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
    @Headers('x-mfa-code') mfaCode?: string,
  ) {
    return this.command(
      req,
      key,
      'PLATFORM_APPROVAL_PROPOSE',
      // Credentials are part of the replay hash but never of the stored journal.
      input,
      () => this.service.propose(req.user, input, mfaCode),
    );
  }

  @Roles('SYSTEM_ADMIN')
  @ApiDataResponse(PlatformApprovalDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader(MFA_HEADER)
  @Post(':id/decision')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: DecideApprovalDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
    @Headers('x-mfa-code') mfaCode?: string,
  ) {
    return this.command(
      req,
      key,
      'PLATFORM_APPROVAL_DECIDE',
      { ...input, id },
      () => this.service.decide(req.user, id, input, mfaCode),
    );
  }

  @Roles('SYSTEM_ADMIN')
  @ApiDataResponse(PlatformApprovalDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CancelApprovalDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(
      req,
      key,
      'PLATFORM_APPROVAL_CANCEL',
      { ...input, id },
      () => this.service.cancel(req.user, id, input),
    );
  }
}

/** Read-only platform operations picture (outbox, holds, ledger jobs, binding
 * health, mail queue, sessions). SYSTEM_ADMIN and AUDITOR may read; there is
 * deliberately no mutating route here: retries and repairs stay with operators. */
@ApiTags('platform-operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'AUDITOR', 'PLATFORM_OPERATOR')
@Controller('platform-operations')
export class PlatformOperationsController {
  constructor(private readonly service: PlatformOperationsService) {}

  @Roles('SYSTEM_ADMIN')
  @ApiDataResponse(AdminSummaryDto)
  @Get('admin-summary')
  adminSummary() {
    return this.service.adminSummary();
  }

  @ApiDataResponse(OperationsSummaryDto)
  @Get('summary')
  summary(@Query() query: OperationsQueryDto) {
    return this.service.summary(query);
  }

  @ApiDataResponse(OutboxPageDto)
  @Get('outbox')
  outbox(@Query() query: OperationsQueryDto) {
    return this.service.outbox(query);
  }

  @ApiDataResponse(HoldPageDto)
  @Get('holds')
  holds(@Query() query: OperationsQueryDto) {
    return this.service.holds(query);
  }

  @ApiDataResponse(JobPageDto)
  @Get('ledger-jobs')
  ledgerJobs(@Query() query: OperationsQueryDto) {
    return this.service.ledgerJobs(query);
  }

  @ApiDataResponse(HealthPageDto)
  @Get('binding-health')
  bindingHealth(@Query() query: OperationsQueryDto) {
    return this.service.bindingHealth(query);
  }

  @ApiDataResponse(MailPageDto)
  @Get('mail')
  mail(@Query() query: OperationsQueryDto) {
    return this.service.mail(query);
  }

  @ApiDataResponse(CredentialsOverviewDto)
  @Get('credentials')
  credentials(@Query() query: OperationsQueryDto) {
    return this.service.credentials(query);
  }
}

const CASE_COMMAND = (
  idem: IdempotencyService,
  req: AuthenticatedRequest,
  key: string,
  operation: string,
  payload: object,
  work: () => Promise<unknown>,
) =>
  idem.executeCommand(
    {
      idempotencyKey: key,
      requesterId: req.user.sub,
      actor: req.user,
      responseStatus: 201,
      operation,
      requestType: 'COMMAND',
      payload,
    },
    work,
  );

/** Incident / complaint cases. Administrators triage and notify; the owning
 * enterprise answers. No route here touches a lot's state, quantity or recall:
 * recall remains a lot command for FARM_STAFF/TRANSPORTER/RETAILER only. */
@ApiTags('platform-cases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('platform-cases')
export class PlatformCasesController {
  constructor(
    private readonly service: PlatformCasesService,
    private readonly idem: IdempotencyService,
  ) {}

  @Roles('SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(CaseOrganizationOptionDto, 200, true)
  @Get('organization-options')
  organizationOptions() {
    return this.service.organizationOptions();
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCasePageDto)
  @Get()
  list(@Query() query: CaseListQueryDto) {
    return this.service.list(query);
  }

  @Roles('SYSTEM_ADMIN', 'AUDITOR', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCaseDetailDto)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Roles('SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post()
  create(
    @Body() input: CreateCaseDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'PLATFORM_CASE_CREATE',
      input,
      () => this.service.create(req.user, input),
    );
  }

  @Roles('SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/classify')
  classify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ClassifyCaseDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'PLATFORM_CASE_CLASSIFY',
      { ...input, id },
      () => this.service.classify(req.user, id, input),
    );
  }

  @Roles('SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AssignCaseDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'PLATFORM_CASE_ASSIGN',
      { ...input, id },
      () => this.service.assign(req.user, id, input),
    );
  }

  @Roles('SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/link-lot')
  linkLot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: LinkCaseLotDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'PLATFORM_CASE_LINK_LOT',
      { ...input, id },
      () => this.service.linkLot(req.user, id, input),
    );
  }

  @Roles('SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/notes')
  note(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CaseNoteDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'PLATFORM_CASE_NOTE',
      { ...input, id },
      () => this.service.note(req.user, id, input),
    );
  }

  @Roles('SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/escalate')
  escalate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: EscalateCaseDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'PLATFORM_CASE_ESCALATE',
      { ...input, id },
      () => this.service.escalate(req.user, id, input),
    );
  }

  @Roles('SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER')
  @ApiDataResponse(PlatformCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/close')
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CloseCaseDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'PLATFORM_CASE_CLOSE',
      { ...input, id },
      () => this.service.close(req.user, id, input),
    );
  }
}

/** The owning organization's side of a case: read what was addressed to it,
 * acknowledge and answer. Shown on /enterprise/notices. */
@ApiTags('enterprise-cases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('FARM_STAFF', 'TRANSPORTER', 'DISTRIBUTOR', 'RETAILER')
@Controller('enterprise-cases')
export class EnterpriseCasesController {
  constructor(
    private readonly service: PlatformCasesService,
    private readonly idem: IdempotencyService,
  ) {}

  @ApiDataResponse(EnterpriseCaseDto, 200, true)
  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.service.listForOrganization(req.user);
  }

  @ApiDataResponse(EnterpriseCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/acknowledge')
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: EnterpriseCaseAckDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'EW_CASE_ACK',
      { ...input, id },
      () => this.service.acknowledge(req.user, id, input),
    );
  }

  @ApiDataResponse(EnterpriseCaseDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/respond')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: EnterpriseCaseResponseDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return CASE_COMMAND(
      this.idem,
      req,
      key,
      'EW_CASE_RESPOND',
      { ...input, id },
      () => this.service.respond(req.user, id, input),
    );
  }
}
