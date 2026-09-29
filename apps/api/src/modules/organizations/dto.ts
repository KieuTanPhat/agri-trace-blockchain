import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateOrganizationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @IsIn(['FARM', 'TRANSPORTER', 'RETAILER', 'AUDITOR'])
  type!: 'FARM' | 'TRANSPORTER' | 'RETAILER' | 'AUDITOR';
}

export class UpdateOrganizationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
