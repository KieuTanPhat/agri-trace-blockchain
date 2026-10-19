import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const NOTICE_AUDIENCES = ['ALL', 'PLATFORM', 'ENTERPRISE', 'FARM', 'TRANSPORTER', 'PROCESSOR', 'DISTRIBUTOR', 'RETAILER'] as const;
export const TICKET_CATEGORIES = ['ACCOUNT', 'BILLING', 'TECHNICAL', 'TRACEABILITY', 'BLOCKCHAIN', 'PROCESSING', 'OTHER'] as const;
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const REPORT_CATEGORIES = ['COUNTERFEIT', 'WRONG_INFORMATION', 'QUALITY', 'SAFETY', 'EXPIRED', 'OTHER'] as const;
export const REFERENCE_CATEGORIES = ['UNIT', 'PRODUCT_CATEGORY', 'CERTIFICATE_TYPE', 'LOSS_REASON', 'PROCESSING_TYPE', 'TICKET_CATEGORY'] as const;

export class ReasonInput {
  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}
export class VersionReasonInput extends ReasonInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}

export class DirectoryQuery {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
  @ApiPropertyOptional({ enum: ['SINGLE', 'SUPPLY_CHAIN_ENTERPRISE'] })
  @IsOptional()
  @IsIn(['SINGLE', 'SUPPLY_CHAIN_ENTERPRISE'])
  model?: string;
  @ApiPropertyOptional({ enum: ['FARM', 'TRANSPORTER', 'PROCESSOR', 'DISTRIBUTOR', 'RETAILER'] })
  @IsOptional()
  @IsIn(['FARM', 'TRANSPORTER', 'PROCESSOR', 'DISTRIBUTOR', 'RETAILER'])
  capability?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'GRACE', 'RESTRICTED', 'PENDING_PAYMENT'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'GRACE', 'RESTRICTED', 'PENDING_PAYMENT'])
  plan?: string;
}

export class LotSearchQuery {
  @ApiProperty({ minLength: 2, maxLength: 120, description: 'Mã lô, mã truy xuất QR hoặc tên sản phẩm' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;
}

export class TraceReportQuery {
  @ApiPropertyOptional({ description: 'true để kèm file CSV dữ liệu khóa (KDE) theo lô' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  export?: boolean;
  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class LedgerTxQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'CONFIRMED', 'FAILED'] })
  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED', 'FAILED'])
  status?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class BlockQrInput extends ReasonInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() lotId!: string;
  @ApiProperty({ minLength: 10, maxLength: 500, description: 'Nội dung cảnh báo hiển thị cho người quét QR' })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  publicMessage!: string;
}

export class SettingChangeInput extends VersionReasonInput {
  @ApiProperty({ description: 'Giá trị JSON mới (số, boolean hoặc đối tượng theo từng tham số)' })
  @IsDefined()
  value!: unknown;
}

export class ReferenceItemInput {
  @ApiProperty({ enum: REFERENCE_CATEGORIES }) @IsIn(REFERENCE_CATEGORIES) category!: string;
  @ApiProperty({ pattern: '^[A-Z0-9_]{1,40}$' }) @Matches(/^[A-Z0-9_]{1,40}$/) code!: string;
  @ApiProperty({ maxLength: 120 }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) @IsIn(['ACTIVE', 'INACTIVE']) status!: string;
  @ApiProperty({ minimum: 0, maximum: 10000 }) @IsInt() @Min(0) @Max(10000) sortOrder!: number;
  @ApiPropertyOptional({ minimum: 0, description: 'Bỏ trống khi tạo mới; phiên bản đã đọc khi sửa' })
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

export class ReferenceQuery {
  @ApiPropertyOptional({ enum: REFERENCE_CATEGORIES }) @IsOptional() @IsIn(REFERENCE_CATEGORIES) category?: string;
}

export class NoticeInput {
  @ApiProperty({ maxLength: 200 }) @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 2000 }) @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) body!: string;
  @ApiProperty({ enum: NOTICE_AUDIENCES }) @IsIn(NOTICE_AUDIENCES) audience!: string;
  @ApiProperty({ enum: ['INFO', 'WARNING', 'MAINTENANCE'] }) @IsIn(['INFO', 'WARNING', 'MAINTENANCE']) severity!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() startsAt!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() endsAt!: string;
}

export class TicketCreateInput {
  @ApiProperty({ enum: TICKET_CATEGORIES }) @IsIn(TICKET_CATEGORIES) category!: string;
  @ApiProperty({ enum: TICKET_PRIORITIES }) @IsIn(TICKET_PRIORITIES) priority!: string;
  @ApiProperty({ maxLength: 200 }) @Transform(trim) @IsString() @MinLength(5) @MaxLength(200) subject!: string;
  @ApiProperty({ maxLength: 4000 }) @Transform(trim) @IsString() @MinLength(10) @MaxLength(4000) body!: string;
}
export class TicketReplyInput {
  @ApiProperty({ maxLength: 4000 }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(4000) body!: string;
  @ApiPropertyOptional({ description: 'Ghi chú nội bộ chỉ nhân sự nền tảng thấy' }) @IsOptional() @IsBoolean() internal?: boolean;
  @ApiPropertyOptional({ enum: ['IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED'] })
  @IsOptional()
  @IsIn(['IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED'])
  status?: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class TicketAssignInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() assigneeId!: string;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class TicketCloseInput extends VersionReasonInput {}
export class TicketQuery {
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'])
  status?: string;
}

export class ConsumerReportInput {
  @ApiProperty({ format: 'uuid', description: 'Mã yêu cầu do trình duyệt tạo để gửi lại an toàn' })
  @IsUUID()
  requestId!: string;
  @ApiProperty({ enum: REPORT_CATEGORIES }) @IsIn(REPORT_CATEGORIES) category!: string;
  @ApiProperty({ maxLength: 2000 }) @Transform(trim) @IsString() @MinLength(10) @MaxLength(2000) description!: string;
  @ApiPropertyOptional({ format: 'email' }) @IsOptional() @IsEmail() @MaxLength(255) contactEmail?: string;
  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @Matches(/^(?:0[35789]\d{8}|02\d{9}|\+84(?:[35789]\d{8}|2\d{9}))$/)
  contactPhone?: string;
  @ApiProperty({ description: 'Bắt buộc true khi để lại thông tin liên hệ' }) @IsBoolean() consent!: boolean;
  @ApiProperty({ enum: [true], description: 'Xác nhận nội dung trung thực' }) @Equals(true) truthful!: boolean;
}
export class ReportTriageInput {
  @ApiProperty({ enum: ['ESCALATE', 'DISMISS', 'DUPLICATE'] }) @IsIn(['ESCALATE', 'DISMISS', 'DUPLICATE']) decision!: string;
  @ApiProperty({ minLength: 10, maxLength: 1000 }) @Transform(trim) @IsString() @MinLength(10) @MaxLength(1000) note!: string;
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity?: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class ReportQuery {
  @ApiPropertyOptional({ enum: ['NEW', 'ESCALATED', 'DISMISSED', 'DUPLICATE'] })
  @IsOptional()
  @IsIn(['NEW', 'ESCALATED', 'DISMISSED', 'DUPLICATE'])
  status?: string;
}

export class AdminRecordDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) record!: Record<string, unknown>;
}
export class AdminListDto {
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true }) items!: Record<string, unknown>[];
}
export class AdminObjectDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @Type(() => Object)
  data?: Record<string, unknown>;
}
export class ReportReceiptDto {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty() received!: boolean;
}
