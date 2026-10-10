import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
  MinLength,
} from 'class-validator';

export class CreateProductionCycleDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  farmId!: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  plotId?: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  productId!: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  cycleCode!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsDateString()
  plannedHarvest?: string;
  @ApiProperty({
    type: Number,
    minimum: 0,
    exclusiveMinimum: true,
    multipleOf: 0.001,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  maxHarvestQuantity!: number;
  @ApiProperty({ type: String, minLength: 1, maxLength: 30 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  harvestUnit!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class VersionedCommandDto {
  @ApiProperty({ type: Number, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class PlantCycleDto extends VersionedCommandDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  plantedAt!: string;
}

export class CareRecordDto extends VersionedCommandDto {
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @MaxLength(100)
  careType!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  eventTime!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  materialName?: string;
  @ApiProperty({
    type: Number,
    required: false,
    minimum: 0,
    exclusiveMinimum: true,
    multipleOf: 0.001,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity?: number;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  unit?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  method?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class SensorReadingDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  deviceId!: string;
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @MaxLength(100)
  sensorType!: string;
  @ApiProperty({ type: Number })
  @Type(() => Number)
  @IsNumber()
  value!: number;
  @ApiProperty({ type: String, maxLength: 30 })
  @IsString()
  @MaxLength(30)
  unit!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  recordedAt!: string;
}

export class CancelCycleDto extends VersionedCommandDto {
  @ApiProperty({ type: String, maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ReconcileCycleSensorDto extends VersionedCommandDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  plantedAt!: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  throughHarvestId?: string;
  @ApiProperty({ type: String, maxLength: 1000, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
