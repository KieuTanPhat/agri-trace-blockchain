import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class RecordHarvestDto {
  @IsDateString() harvestTime!: string;
  @Type(() => Number) @IsPositive() quantity!: number;
  @IsString() @MaxLength(30) unit!: string;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsString() qualityNote?: string;
  @IsOptional() @IsString() harvestArea?: string;
  @IsOptional() @IsUUID() finalSensorDigestId?: string;
  @IsOptional() @IsString() @MaxLength(120) lotCode?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}

export class RecordFarmDamageDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lotVersion!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}