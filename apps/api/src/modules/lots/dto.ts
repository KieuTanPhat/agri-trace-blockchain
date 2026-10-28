import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class RecordHarvestDto {
  @ApiProperty({ type: Number, minimum: 0 })
  @Type(() => Number) @IsInt() @Min(0)
  version!: number;
  @ApiProperty({ type: String, minLength: 1, maxLength: 255 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(255)
  lotName!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  representativeUserId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  evidenceRef!: string;
  @ApiProperty({ type: [String], format: 'uuid', required: false, maxItems: 4 })
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ArrayUnique() @IsUUID('4', { each: true })
  additionalEvidenceRefs?: string[];
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  lotImageEvidenceRef!: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  harvestMethod?: string;
  @ApiProperty({ required: false, type: Number, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  packageCount?: number;
  @ApiProperty({ required: false, maxLength: 255 })
  @IsOptional() @IsString() @MaxLength(255)
  packaging?: string;
  @ApiProperty({ required: false, format: 'date' })
  @IsOptional() @IsDateString()
  packedAt?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional() @IsUUID()
  initialStorageSiteId?: string;
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  harvestTime!: string;
  @ApiProperty({
    type: Number,
    minimum: 0,
    exclusiveMinimum: true,
    multipleOf: 0.001,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
  @ApiProperty({ type: String, minLength: 1, maxLength: 30 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  grade?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  qualityNote?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  harvestArea?: string;
  @ApiProperty({ type: String, required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  lotCode?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class LotVersionCommandDto {
  @ApiProperty({ type: Number, minimum: 0, maximum: 2147483647 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  version!: number;
  @ApiProperty({
    type: Number,
    required: false,
    minimum: 0,
    maximum: 2147483647,
    description: 'Required when the Lot has a Shipment',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  shipmentVersion?: number;
}

export class LotReasonCommandDto extends LotVersionCommandDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class DamageLotDto extends LotReasonCommandDto {
  @ApiProperty({
    type: Number,
    minimum: 0,
    exclusiveMinimum: true,
    multipleOf: 0.001,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
  @ApiProperty({ required: false, maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  evidenceRef?: string;
}
