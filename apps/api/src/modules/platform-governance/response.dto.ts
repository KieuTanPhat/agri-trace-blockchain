import { ApiProperty } from '@nestjs/swagger';

export class PlatformWhoDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) fullName!: string;
  @ApiProperty({ type: String, format: 'email' }) email!: string;
}

class AuditOrganizationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class PlatformAuditEntryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, description: 'Số thứ tự liên tục của chuỗi' })
  sequence!: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: PlatformWhoDto, nullable: true })
  actor!: PlatformWhoDto | null;
  @ApiProperty({ type: String }) actorRole!: string;
  @ApiProperty({ type: String }) action!: string;
  @ApiProperty({ type: String }) subjectType!: string;
  @ApiProperty({ type: String }) subjectId!: string;
  @ApiProperty({ type: AuditOrganizationDto, nullable: true })
  organization!: AuditOrganizationDto | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) requestId!: string | null;
  @ApiProperty({ type: String, nullable: true }) idempotencyKey!: string | null;
  @ApiProperty({ enum: ['SUCCESS', 'DENIED', 'FAILED'] }) outcome!: string;
  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description: 'Chi tiết đã che các khóa nhạy cảm',
  })
  details!: Record<string, unknown>;
  @ApiProperty({ type: String }) prevHash!: string;
  @ApiProperty({ type: String }) entryHash!: string;
}

export class PlatformAuditPageDto {
  @ApiProperty({ type: [PlatformAuditEntryDto] })
  items!: PlatformAuditEntryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class AdminSummaryDto {
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: string;
  @ApiProperty() openCases!: number;
  @ApiProperty() overdueCases!: number;
  @ApiProperty() privacyRequests!: number;
  @ApiProperty() breachReportsDue!: number;
  @ApiProperty() breachReportsOverdue!: number;
  @ApiProperty() lockedAccounts!: number;
}

export class CaseOrganizationOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() type!: string;
}

export class PlatformAuditExportDto {
  @ApiProperty({ type: String }) filename!: string;
  @ApiProperty({ type: Number }) rowCount!: number;
  @ApiProperty({ type: Boolean }) truncated!: boolean;
  @ApiProperty({ type: Number }) limit!: number;
  @ApiProperty({ type: String, description: 'Nội dung CSV (UTF-8)' })
  csv!: string;
}

class ChainInvalidDto {
  @ApiProperty({ type: String }) sequence!: string;
  @ApiProperty({ type: String }) reason!: string;
}

export class PlatformAuditVerificationDto {
  @ApiProperty({ type: Boolean }) ok!: boolean;
  @ApiProperty({ type: Number }) checked!: number;
  @ApiProperty({ type: String, nullable: true }) headSequence!: string | null;
  @ApiProperty({ type: String, nullable: true }) headHash!: string | null;
  @ApiProperty({ type: ChainInvalidDto, nullable: true })
  firstInvalid!: ChainInvalidDto | null;
}

export class MfaStatusDto {
  @ApiProperty({ enum: ['OFF', 'OPTIONAL', 'REQUIRED'] }) mode!: string;
  @ApiProperty({ enum: ['NONE', 'PENDING', 'ENABLED'] }) status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  enabledAt!: string | null;
  @ApiProperty({ type: Number }) recoveryCodesRemaining!: number;
}

export class MfaEnrollmentDto {
  @ApiProperty({ type: String, description: 'Seed base32, chỉ trả một lần' })
  secret!: string;
  @ApiProperty({ type: String }) otpauthUri!: string;
}

export class MfaEnabledDto {
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({
    type: [String],
    description: 'Mã khôi phục dùng một lần, chỉ trả một lần',
  })
  recoveryCodes!: string[];
}

export class MfaDisabledDto {
  @ApiProperty({ type: Boolean }) enabled!: boolean;
}

const SCOPES = ['chain', 'organization'];

class OperationsFiltersDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  chainId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  organizationId!: string | null;
}

class OutboxCountsDto {
  @ApiProperty({ type: Number }) PENDING!: number;
  @ApiProperty({ type: Number }) PROCESSING!: number;
  @ApiProperty({ type: Number }) RETRY!: number;
  @ApiProperty({ type: Number }) COMPLETED!: number;
  @ApiProperty({ type: Number }) DEAD_LETTER!: number;
}

class OutboxSummaryDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({ type: OutboxCountsDto }) counts!: OutboxCountsDto;
  @ApiProperty({ type: Number, nullable: true })
  oldestUnfinishedAgeSeconds!: number | null;
  @ApiProperty({ type: Number, description: 'PENDING/RETRY quá hạn > 5 phút' })
  overdue!: number;
}

class HoldsSummaryDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({ type: Number }) open!: number;
  @ApiProperty({ type: Number, nullable: true })
  oldestOpenAgeSeconds!: number | null;
}

class JobCountsDto {
  @ApiProperty({ type: Number }) PENDING!: number;
  @ApiProperty({ type: Number }) PROCESSING!: number;
  @ApiProperty({ type: Number }) COMPLETED!: number;
  @ApiProperty({ type: Number }) FAILED!: number;
}

class JobsSummaryDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({ type: JobCountsDto }) counts!: JobCountsDto;
  @ApiProperty({ type: Number, nullable: true })
  oldestUnfinishedAgeSeconds!: number | null;
}

class HealthSummaryDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({
    type: Number,
    description: 'Có lỗi, chưa từng khỏe hoặc không được kiểm tra > 10 phút',
  })
  unhealthy!: number;
}

class MailCountsDto {
  @ApiProperty({ type: Number }) PENDING!: number;
  @ApiProperty({ type: Number }) SENT!: number;
  @ApiProperty({ type: Number }) CANCELLED!: number;
}

class MailSummaryDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({ type: MailCountsDto }) counts!: MailCountsDto;
  @ApiProperty({ type: Number, description: 'PENDING đã thử gửi lỗi ≥ 1 lần' })
  retrying!: number;
  @ApiProperty({ type: Number, nullable: true })
  oldestPendingAgeSeconds!: number | null;
  @ApiProperty({ type: Number }) overdue!: number;
}

class AccountsSummaryDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({ type: Number }) activeSessions!: number;
  @ApiProperty({ type: Number }) lockedAccounts!: number;
  @ApiProperty({ type: Number }) disabledAccounts!: number;
}

export class OperationsSummaryDto {
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: OperationsFiltersDto }) filters!: OperationsFiltersDto;
  @ApiProperty({ type: OutboxSummaryDto }) outbox!: OutboxSummaryDto;
  @ApiProperty({ type: HoldsSummaryDto }) holds!: HoldsSummaryDto;
  @ApiProperty({ type: JobsSummaryDto }) ledgerJobs!: JobsSummaryDto;
  @ApiProperty({ type: HealthSummaryDto }) bindingHealth!: HealthSummaryDto;
  @ApiProperty({ type: MailSummaryDto }) mail!: MailSummaryDto;
  @ApiProperty({ type: AccountsSummaryDto }) accounts!: AccountsSummaryDto;
}

class OrgBriefDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class OutboxItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) eventId!: string;
  @ApiProperty({ type: String }) eventType!: string;
  @ApiProperty({
    enum: ['PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'DEAD_LETTER'],
  })
  status!: string;
  @ApiProperty({ type: Number }) attemptCount!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextAttemptAt!: string | null;
  @ApiProperty({ type: Boolean }) leased!: boolean;
  @ApiProperty({ type: String, nullable: true }) lastError!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: Number }) ageSeconds!: number;
  @ApiProperty({ type: OrgBriefDto, nullable: true })
  organization!: OrgBriefDto | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  chainId!: string | null;
  @ApiProperty({ type: String, nullable: true }) chainName!: string | null;
}

export class HoldItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['BINDING', 'PERMISSION', 'EVENT'] }) scope!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String, format: 'date-time' }) openedAt!: string;
  @ApiProperty({ type: Number }) ageSeconds!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  eventId!: string | null;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
}

export class JobItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) operation!: string;
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] })
  status!: string;
  @ApiProperty({ type: Number }) attemptCount!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextAttemptAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastError!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: Number }) ageSeconds!: number;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
}

export class HealthItemDto {
  @ApiProperty({ type: String, description: '16 ký tự đầu của digest' })
  bindingDigest!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) lastCheckedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastHealthyAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastErrorCode!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  certificateExpiresAt!: string | null;
  @ApiProperty({ type: Boolean }) stale!: boolean;
}

export class MailItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) kind!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Number }) attempts!: number;
  @ApiProperty({ type: String, format: 'date-time' }) nextAttemptAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sentAt!: string | null;
  @ApiProperty({ type: Number }) ageSeconds!: number;
  @ApiProperty({ type: OrgBriefDto, nullable: true })
  organization!: OrgBriefDto | null;
}

export class OutboxPageDto {
  @ApiProperty({ type: [OutboxItemDto] }) items!: OutboxItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class HoldPageDto {
  @ApiProperty({ type: [HoldItemDto] }) items!: HoldItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class JobPageDto {
  @ApiProperty({ type: [JobItemDto] }) items!: JobItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class HealthPageDto {
  @ApiProperty({ type: [HealthItemDto] }) items!: HealthItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class MailPageDto {
  @ApiProperty({ type: [MailItemDto] }) items!: MailItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

class CertificateItemDto {
  @ApiProperty({ type: String, description: '16 ký tự đầu của digest' })
  bindingDigest!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  certificateExpiresAt!: string;
  @ApiProperty({ type: Number, description: 'Âm nếu đã hết hạn' })
  daysLeft!: number;
  @ApiProperty({ enum: ['EXPIRED', '7_DAYS', '14_DAYS', '30_DAYS'] })
  bucket!: string;
  @ApiProperty({ type: String, format: 'date-time' }) lastCheckedAt!: string;
}

class CertificatesDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({ type: Number }) expired!: number;
  @ApiProperty({ type: Number }) within7Days!: number;
  @ApiProperty({ type: Number }) within14Days!: number;
  @ApiProperty({ type: Number }) within30Days!: number;
  @ApiProperty({
    type: Number,
    description: 'Kết nối Worker chưa báo ngày hết hạn chứng thư',
  })
  unknownExpiry!: number;
  @ApiProperty({ type: [CertificateItemDto] }) items!: CertificateItemDto[];
}

class RevokedCredentialDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) bindingDigest!: string;
  @ApiProperty({ type: String, description: '16 ký tự đầu vân tay chứng thư' })
  fingerprint!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) revokedAt!: string;
}

class CredentialsRevocationDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({ type: Number }) approved!: number;
  @ApiProperty({
    type: Number,
    description: 'Số mục thu hồi trong danh sách (tối đa 50)',
  })
  revoked!: number;
  @ApiProperty({ type: [RevokedCredentialDto] }) items!: RevokedCredentialDto[];
}

class SigningKeyCountsDto {
  @ApiProperty({ type: Number }) PENDING_LEDGER!: number;
  @ApiProperty({ type: Number }) ACTIVE!: number;
  @ApiProperty({ type: Number }) REVOKED!: number;
}

class RevokedSigningKeyDto {
  @ApiProperty({ type: String, format: 'uuid' }) keyRef!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ type: OrgBriefDto }) organization!: OrgBriefDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) revokeReason!: string | null;
}

class SigningKeysDto {
  @ApiProperty({ type: [String], enum: SCOPES }) scopedBy!: string[];
  @ApiProperty({
    type: Boolean,
    description:
      'Luôn false: khóa ký Ed25519 chưa có ngày hết hạn trong hệ thống',
  })
  expiryTracked!: boolean;
  @ApiProperty({ type: SigningKeyCountsDto }) counts!: SigningKeyCountsDto;
  @ApiProperty({ type: [RevokedSigningKeyDto] }) items!: RevokedSigningKeyDto[];
}

export class CredentialsOverviewDto {
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: CertificatesDto }) certificates!: CertificatesDto;
  @ApiProperty({ type: CredentialsRevocationDto })
  credentials!: CredentialsRevocationDto;
  @ApiProperty({ type: SigningKeysDto }) signingKeys!: SigningKeysDto;
}

class CaseLotDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) lotCode!: string;
}

export class PlatformCaseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: Number }) caseNumber!: number;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({
    enum: ['QUALITY', 'SAFETY', 'LABELING', 'COUNTERFEIT', 'OTHER'],
  })
  category!: string;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  severity!: string;
  @ApiProperty({ enum: ['CONSUMER', 'ENTERPRISE', 'AUDITOR', 'INTERNAL'] })
  source!: string;
  @ApiProperty({
    enum: [
      'OPEN',
      'ASSIGNED',
      'ACKNOWLEDGED',
      'RESPONDED',
      'ESCALATED',
      'CLOSED',
    ],
  })
  status!: string;
  @ApiProperty({ type: CaseLotDto, nullable: true }) lot!: CaseLotDto | null;
  @ApiProperty({ type: OrgBriefDto, nullable: true })
  owner!: OrgBriefDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  responseDueAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  acknowledgedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  respondedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  escalatedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) closeReason!: string | null;
  @ApiProperty({ type: Boolean, description: 'Quá hạn phản hồi' })
  overdue!: boolean;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

class CaseActorDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) fullName!: string;
}

export class PlatformCaseEventDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({
    enum: [
      'CREATED',
      'CLASSIFIED',
      'LOT_LINKED',
      'ASSIGNED',
      'ACKNOWLEDGED',
      'RESPONDED',
      'ESCALATED',
      'NOTE',
      'CLOSED',
    ],
  })
  action!: string;
  @ApiProperty({ enum: ['INTERNAL', 'SHARED'] }) visibility!: string;
  @ApiProperty({ type: CaseActorDto }) actor!: CaseActorDto;
  @ApiProperty({ type: OrgBriefDto, nullable: true })
  organization!: OrgBriefDto | null;
  @ApiProperty({ type: String }) note!: string;
  @ApiProperty({ type: Object, additionalProperties: true })
  details!: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class PlatformCaseDetailDto extends PlatformCaseDto {
  @ApiProperty({ type: [PlatformCaseEventDto] })
  events!: PlatformCaseEventDto[];
}

export class PlatformCasePageDto {
  @ApiProperty({ type: [PlatformCaseDto] }) items!: PlatformCaseDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

class EnterpriseCaseEventDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) action!: string;
  @ApiProperty({ type: String }) note!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

/** What an organization sees: no source, no internal history, no creator. */
export class EnterpriseCaseDto {
  @ApiProperty({ type: String, isArray: true }) allowedActions!: string[];
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: Number }) caseNumber!: number;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: String }) category!: string;
  @ApiProperty({ type: String }) severity!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: CaseLotDto, nullable: true }) lot!: CaseLotDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  responseDueAt!: string | null;
  @ApiProperty({ type: Boolean }) overdue!: boolean;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [EnterpriseCaseEventDto] })
  events!: EnterpriseCaseEventDto[];
}
