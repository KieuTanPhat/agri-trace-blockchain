import { Type } from 'class-transformer';
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
} from 'class-validator';

export class CreateProductionCycleDto {
  @IsUUID() farmId!: string;
  @IsOptional() @IsUUID() plotId?: string;
  @IsUUID() productId!: string;
  @IsString() @MaxLength(100) cycleCode!: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() plannedHarvest?: string;
  @Type(() => Number) @IsNumber() @IsPositive() maxHarvestQuantity!: number;
  @IsString() @MaxLength(30) harvestUnit!: string;
  @IsOptional() @IsString() note?: string;
}

export class VersionedCommandDto {
  @Type(() => Number) @IsInt() @Min(0) version!: number;
}

export class PlantCycleDto extends VersionedCommandDto {
  @IsDateString() plantedAt!: string;
}

export class CareRecordDto extends VersionedCommandDto {
  @IsString() @MaxLength(100) careType!: string;
  @IsDateString() eventTime!: string;
  @IsOptional() @IsString() materialName?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive() quantity?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() note?: string;
}

export class SensorReadingDto {
  @IsUUID() deviceId!: string;
  @IsString() @MaxLength(100) sensorType!: string;
  @Type(() => Number) @IsNumber() value!: number;
  @IsString() @MaxLength(30) unit!: string;
  @IsDateString() recordedAt!: string;
}

export class CancelCycleDto extends VersionedCommandDto {
  @IsString() @MaxLength(500) reason!: string;
}
