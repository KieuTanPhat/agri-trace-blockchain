import { ApiProperty } from '@nestjs/swagger';
import {
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
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsString()
  grade?: string;
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsString()
  qualityNote?: string;
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsString()
  harvestArea?: string;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  finalSensorDigestId?: string;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  lotCode?: string;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    description:
      'YYYY-MM-DD or an ISO 8601 timestamp with timezone; normalized to the Vietnam calendar date. Projected responses use YYYY-MM-DD.',
    example: '2026-10-13',
  })
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
    nullable: true,
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
  @ApiProperty({ required: false, nullable: true, maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  evidenceRef?: string;
}
