import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PlanLimitsInput {
  @ApiProperty({ minimum: 0, maximum: 100000 })
  @IsInt()
  @Min(0)
  @Max(100000)
  products!: number;
  @ApiProperty({ minimum: 0, maximum: 1000 })
  @IsInt()
  @Min(0)
  @Max(1000)
  chains!: number;
  @ApiProperty({ minimum: 1, maximum: 100000 })
  @IsInt()
  @Min(1)
  @Max(100000)
  members!: number;
}

export class PlanVersionDraftInput {
  @ApiProperty({ minimum: 0, maximum: 10000000000 })
  @IsInt()
  @Min(0)
  @Max(10_000_000_000)
  setupFee!: number;
  @ApiProperty({ minimum: 0, maximum: 10000000000 })
  @IsInt()
  @Min(0)
  @Max(10_000_000_000)
  annualFee!: number;
  @ApiProperty({ minimum: 1, maximum: 60 })
  @IsInt()
  @Min(1)
  @Max(60)
  termMonths!: number;
  @ApiProperty({ type: PlanLimitsInput })
  @ValidateNested()
  @Type(() => PlanLimitsInput)
  limits!: PlanLimitsInput;
  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;
}

export class BillingReasonInput {
  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class InvoiceVersionInput extends BillingReasonInput {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  version!: number;
}

export class ConfirmPaymentInput extends InvoiceVersionInput {
  @ApiProperty({
    maxLength: 120,
    description: 'Mã giao dịch ngân hàng/nội dung chuyển khoản đã đối chiếu',
  })
  @Transform(trim)
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  reference!: string;
}

export class IssueRenewalInput extends BillingReasonInput {
  @ApiProperty({ pattern: '^[A-Z][A-Z0-9_]{1,29}$' })
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/)
  planCode!: string;
}

export class EnterpriseRenewalInput {
  @ApiProperty({ pattern: '^[A-Z][A-Z0-9_]{1,29}$' })
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/)
  planCode!: string;
}

export class EnterpriseInvoicePayInput {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  version!: number;
}

export class InvoiceQuery {
  @ApiPropertyOptional({ enum: ['ISSUED', 'PAID', 'VOID', 'OVERDUE'] })
  @IsOptional()
  @IsIn(['ISSUED', 'PAID', 'VOID', 'OVERDUE'])
  status?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class SubscriptionQuery {
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'GRACE', 'RESTRICTED', 'PENDING_PAYMENT', 'CANCELLED', 'EXPIRING'],
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'GRACE', 'RESTRICTED', 'PENDING_PAYMENT', 'CANCELLED', 'EXPIRING'])
  status?: string;
}

export class RevenueQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 36, default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;
}

export class BillingRecordDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  record!: Record<string, unknown>;
}
export class BillingListDto {
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  items!: Record<string, unknown>[];
}
export class EnterpriseBillingDto {
  @ApiProperty() applies!: boolean;
  @ApiProperty() paying!: boolean;
  @ApiProperty({
    enum: ['UNRESTRICTED', 'PARTICIPANT', 'NONE', 'ACTIVE', 'GRACE', 'RESTRICTED', 'PENDING_PAYMENT', 'CANCELLED'],
  })
  status!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  limits!: Record<string, number> | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  usage!: Record<string, number>;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  subscription!: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  invoices!: Record<string, unknown>[];
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  plans!: Record<string, unknown>[];
  @ApiProperty() simulationEnabled!: boolean;
}
export class RevenueReportDto {
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  months!: Record<string, unknown>[];
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  byPlan!: Record<string, unknown>[];
  @ApiProperty() paidTotal!: number;
  @ApiProperty() simulatedTotal!: number;
  @ApiProperty() outstandingTotal!: number;
  @ApiProperty() overdueTotal!: number;
  @ApiProperty() activeSubscriptions!: number;
  @ApiProperty() expiringIn30Days!: number;
  @ApiProperty() note!: string;
}
