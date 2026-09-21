import {
  IsDateString,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

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
