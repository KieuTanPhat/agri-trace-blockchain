import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class ServiceQuoteInput {
  @ApiProperty({
    pattern: '^[A-Z][A-Z0-9_]{1,29}$',
    description: 'Published plan code for the organization participation model',
  })
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/)
  planCode!: string;
  @ApiProperty({ format: 'email', maxLength: 255 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  billingEmail!: string;
  @ApiProperty({ minLength: 2, maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  billingName!: string;
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  billingAddress!: string;
  @ApiProperty({
    description:
      'Catalog version of the exact quotation previewed (digest of the published plan versions)',
    maxLength: 80,
  })
  @IsString()
  @MaxLength(80)
  catalogVersion!: string;
}
export class ServiceOrderInput extends ServiceQuoteInput {
  @ApiProperty({
    enum: [true],
    description:
      'Acknowledgement of the local demonstration contract; no qualified digital signature',
  })
  @Equals(true)
  accepted!: boolean;
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  @Matches(/^[a-f0-9]{64}$/)
  contractDigest!: string;
}
export class ServicePaymentInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({
    pattern: '^[a-f0-9]{64}$',
    description: 'Digest of the immutable contract shown before payment',
  })
  @Matches(/^[a-f0-9]{64}$/)
  contractDigest!: string;
  @ApiProperty({
    enum: ['LOCAL_DEMO'],
    description: 'No real card, bank account, NAPAS or QR payment is accepted',
  })
  @Equals('LOCAL_DEMO')
  method!: 'LOCAL_DEMO';
}
export class ServiceOrderView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() planCode!: string;
  @ApiProperty() billingEmail!: string;
  @ApiProperty() billingName!: string;
  @ApiProperty() billingAddress!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ type: Object, additionalProperties: true }) quotation!: Record<
    string,
    unknown
  >;
  @ApiProperty() contractText!: string;
  @ApiProperty() contractDigest!: string;
  @ApiProperty() hasPdf!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) pdfSha256!:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) templateVersion!:
    string | null;
  @ApiProperty({ enum: ['AWAITING_PAYMENT', 'PAID_SIMULATED', 'PAID'] })
  status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) acceptedAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  paidAt!: string | null;
}
export class ServiceContractFileView {
  @ApiProperty() filename!: string;
  @ApiProperty({ enum: ['application/pdf'] }) contentType!: string;
  @ApiProperty() sha256!: string;
  @ApiProperty({
    description:
      'Private PDF bytes encoded as base64; never a public download URL',
  })
  contentBase64!: string;
}
export class ServiceContractHistoryView {
  @ApiProperty() id!: string;
  @ApiProperty() action!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty() outcome!: string;
}
export class ServicePreviewView {
  @ApiProperty({ type: Object, additionalProperties: true }) quotation!: Record<
    string,
    unknown
  >;
  @ApiProperty() contractText!: string;
  @ApiProperty() contractDigest!: string;
  @ApiProperty() previewId!: string;
  @ApiProperty() pdfSha256!: string;
  @ApiProperty() templateVersion!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: ServiceQuoteInput }) input!: ServiceQuoteInput;
}
export class ServiceWorkspaceView {
  @ApiPropertyOptional({ type: ServicePreviewView, nullable: true })
  latestPreview!: ServicePreviewView | null;
  @ApiProperty({ type: [ServiceContractHistoryView] })
  history!: ServiceContractHistoryView[];
  @ApiProperty() stage!: string;
  @ApiProperty({ type: () => ServiceCatalogView }) catalog!: Record<
    string,
    unknown
  >;
  @ApiPropertyOptional({ type: ServiceOrderView, nullable: true })
  order!: ServiceOrderView | null;
  @ApiProperty({ type: Object, additionalProperties: true, isArray: true })
  emails!: Array<Record<string, unknown>>;
}
export class EnterpriseAccessView {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 3, nullable: true })
  tier?: number | null;
  @ApiProperty() stage!: string;
  @ApiProperty() owner!: boolean;
  @ApiProperty() primary!: boolean;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ type: [String] }) capabilities!: string[];
}
export class AddressWardView {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
export class AddressProvinceView extends AddressWardView {
  @ApiProperty({ type: [AddressWardView] }) wards!: AddressWardView[];
}
export class ServiceCatalogView {
  @ApiProperty() version!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() termMonths!: number;
  @ApiProperty() sourceUrl!: string;
  @ApiProperty() sourceDate!: string;
  @ApiProperty() checkedAt!: string;
  @ApiProperty() disclaimer!: string;
  @ApiProperty({ type: () => [ServicePlanView] }) plans!: Array<
    Record<string, unknown>
  >;
  @ApiProperty({ type: Object, additionalProperties: true, isArray: true })
  qrReference!: Array<Record<string, unknown>>;
  @ApiProperty() simulationEnabled!: boolean;
}
export class ServicePlanLimitsView {
  @ApiProperty() products!: number;
  @ApiProperty() chains!: number;
  @ApiProperty() members!: number;
}
export class ServicePlanVersionView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() setupFee!: number;
  @ApiProperty() annualFee!: number;
  @ApiProperty() termMonths!: number;
  @ApiProperty({ type: ServicePlanLimitsView }) limits!: ServicePlanLimitsView;
}
class ServicePlanView {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: ServicePlanVersionView })
  version!: ServicePlanVersionView;
}
