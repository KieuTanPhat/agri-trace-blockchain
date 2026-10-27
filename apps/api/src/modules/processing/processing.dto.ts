import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
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
import { PROCESSING_TYPES } from '../enterprise-onboarding/registration-profile.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const QUANTITY = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;
const FACTOR = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,6})?$/;
export const LOSS_REASONS = [
  'TRIMMING',
  'MOISTURE',
  'SPILLAGE',
  'QUALITY_REJECT',
  'SAMPLING',
  'OTHER',
] as const;

export class ProcessingInputLine {
  @ApiProperty({ format: 'uuid' }) @IsUUID() lotId!: string;
  @ApiProperty({ pattern: QUANTITY.source, description: 'Lượng dùng, theo đơn vị cơ sở của lệnh' })
  @Matches(QUANTITY)
  quantity!: string;
}

export class ProcessingOutputLine {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId!: string;
  @ApiProperty({ enum: ['PRODUCT', 'BY_PRODUCT'] })
  @IsIn(['PRODUCT', 'BY_PRODUCT'])
  kind!: string;
  @ApiProperty({ pattern: QUANTITY.source }) @Matches(QUANTITY) quantity!: string;
  @ApiProperty({ maxLength: 30 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;
  @ApiPropertyOptional({
    pattern: QUANTITY.source,
    description:
      'Không bắt buộc. Server tự tính bằng lượng × hệ số quy đổi đã khai của sản phẩm; nếu gửi, phải khớp giá trị server tính.',
  })
  @IsOptional()
  @Matches(QUANTITY)
  baseQuantity?: string;
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  lotName?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  grade?: string;
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  packaging?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 10000000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  packageCount?: number;
  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiryDate?: string;
}

export class ProcessingLossLine {
  @ApiProperty({ enum: LOSS_REASONS }) @IsIn(LOSS_REASONS) reason!: string;
  @ApiProperty({ pattern: QUANTITY.source }) @Matches(QUANTITY) quantity!: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ProcessingExternalLine {
  @ApiProperty({ format: 'uuid', description: 'Phiếu nhập nguyên liệu ngoài' }) @IsUUID() receiptId!: string;
  @ApiProperty({ pattern: QUANTITY.source, description: 'Lượng dùng, theo đơn vị cơ sở của lệnh' })
  @Matches(QUANTITY)
  quantity!: string;
}

/** Lot and external material lines; at least one line overall. */
export class ProcessingMaterialLines {
  @ApiProperty({ type: [ProcessingInputLine], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProcessingInputLine)
  inputs!: ProcessingInputLine[];
  @ApiProperty({ type: [ProcessingExternalLine], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProcessingExternalLine)
  externalInputs!: ProcessingExternalLine[];
}

export class CreateProcessingRunInput extends ProcessingMaterialLines {
  @ApiProperty({ format: 'uuid' }) @IsUUID() chainId!: string;
  @ApiProperty({ format: 'uuid', description: 'Cơ sở chế biến/đóng gói đang giữ nguyên liệu' })
  @IsUUID()
  siteId!: string;
  @ApiProperty({ format: 'uuid', description: 'Sản phẩm chính cần chế biến (danh mục doanh nghiệp)' })
  @IsUUID()
  productId!: string;
  @ApiProperty({ enum: PROCESSING_TYPES }) @IsIn(PROCESSING_TYPES) processType!: string;
  @ApiProperty({ maxLength: 30, description: 'Đơn vị của mọi nguyên liệu đầu vào' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  baseUnit!: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  recipe?: string;
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AddProcessingInputsInput extends ProcessingMaterialLines {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}

export const PROCESSING_STEPS = [
  'RECEIVING', 'SORTING', 'WASHING', 'PRELIMINARY', 'DRYING', 'ROASTING', 'MILLING',
  'FERMENTING', 'COOKING', 'FREEZING', 'PACKING', 'QUALITY_CHECK', 'CORRECTION', 'OTHER',
] as const;

export class ProcessingLogInput {
  @ApiProperty({ enum: PROCESSING_STEPS }) @IsIn(PROCESSING_STEPS) step!: string;
  @ApiProperty({ format: 'date-time', description: 'Thời điểm thực hiện bước' })
  @IsISO8601()
  occurredAt!: string;
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Dòng nhật ký được đính chính (bắt buộc khi step = CORRECTION)' })
  @IsOptional()
  @IsUUID()
  correctsId?: string;
}

export class ProcessingMainOutput {
  @ApiProperty({ pattern: QUANTITY.source }) @Matches(QUANTITY) quantity!: string;
  @ApiProperty({ maxLength: 30 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;
  @ApiPropertyOptional({ maxLength: 255 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(255) lotName?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) grade?: string;
  @ApiPropertyOptional({ maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) packaging?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 10000000 }) @IsOptional() @IsInt() @Min(1) @Max(10_000_000) packageCount?: number;
  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiryDate?: string;
}

/** Ra lò: the main product, optional by-products and losses, in one step. */
export class CompleteProcessingInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ type: ProcessingMainOutput }) @ValidateNested() @Type(() => ProcessingMainOutput) output!: ProcessingMainOutput;
  @ApiProperty({ type: [ProcessingOutputLine], maxItems: 10, description: 'Phụ phẩm (kind = BY_PRODUCT)' })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProcessingOutputLine)
  byProducts!: ProcessingOutputLine[];
  @ApiProperty({ type: [ProcessingLossLine], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProcessingLossLine)
  losses!: ProcessingLossLine[];
}

export class CreateMaterialReceiptInput {
  @ApiProperty({ format: 'uuid', description: 'Cơ sở chế biến/đóng gói nhận hàng' }) @IsUUID() siteId!: string;
  @ApiProperty({ maxLength: 255 }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) materialName!: string;
  @ApiProperty({ maxLength: 255 }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) supplierName!: string;
  @ApiProperty({ maxLength: 100, description: 'Số hóa đơn / chứng từ' }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) documentNo!: string;
  @ApiProperty({ format: 'date-time' }) @IsISO8601() receivedAt!: string;
  @ApiProperty({ pattern: QUANTITY.source }) @Matches(QUANTITY) quantity!: string;
  @ApiProperty({ maxLength: 30 }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(30) unit!: string;
  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiryDate?: string;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}

export class MaterialReceiptQuery {
  @ApiPropertyOptional({ enum: ['AGRITRACE', 'EXTERNAL'] }) @IsOptional() @IsIn(['AGRITRACE', 'EXTERNAL']) source?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() siteId?: string;
}

export class CreateUnitConversionInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId!: string;
  @ApiProperty({ maxLength: 30, description: 'Đơn vị ghi nhận thành phẩm, ví dụ hộp' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;
  @ApiProperty({ maxLength: 30, description: 'Đơn vị cơ sở của lệnh chế biến, ví dụ kg' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  baseUnit!: string;
  @ApiProperty({ pattern: FACTOR.source, description: 'Số đơn vị cơ sở trong một đơn vị ghi nhận' })
  @Matches(FACTOR)
  factor!: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RevokeUnitConversionInput {
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class UnitConversionQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() productId?: string;
}

export class ProcessingVersionInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}

export class CancelProcessingInput extends ProcessingVersionInput {
  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class ProcessingQuery {
  @ApiPropertyOptional({ enum: ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status?: string;
}

export class ProcessingRecordDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  record!: Record<string, unknown>;
}
export class ProcessingListDto {
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  items!: Record<string, unknown>[];
}
export class LotLineageDto {
  @ApiProperty({ format: 'uuid' }) lotId!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    isArray: true,
    description: 'Lô nguyên liệu (truy ngược) theo từng cấp',
  })
  upstream!: Record<string, unknown>[];
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    isArray: true,
    description: 'Lô thành phẩm được tạo từ lô này (truy xuôi)',
  })
  downstream!: Record<string, unknown>[];
}
