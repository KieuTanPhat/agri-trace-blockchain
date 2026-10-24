import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

export class CreateProcessingRunInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() chainId!: string;
  @ApiProperty({ format: 'uuid', description: 'Cơ sở chế biến/đóng gói đang giữ nguyên liệu' })
  @IsUUID()
  siteId!: string;
  @ApiProperty({ enum: PROCESSING_TYPES }) @IsIn(PROCESSING_TYPES) processType!: string;
  @ApiProperty({ maxLength: 30, description: 'Đơn vị của mọi lô đầu vào' })
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
  @ApiProperty({ type: [ProcessingInputLine], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProcessingInputLine)
  inputs!: ProcessingInputLine[];
  @ApiProperty({ type: [ProcessingOutputLine], minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProcessingOutputLine)
  outputs!: ProcessingOutputLine[];
  @ApiProperty({ type: [ProcessingLossLine], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProcessingLossLine)
  losses!: ProcessingLossLine[];
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
  @ApiPropertyOptional({ enum: ['DRAFT', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'COMPLETED', 'CANCELLED'])
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
