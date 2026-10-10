import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateOrganizationDto {
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @ApiProperty({ enum: ['FARM', 'TRANSPORTER', 'RETAILER', 'AUDITOR'] })
  @IsIn(['FARM', 'TRANSPORTER', 'RETAILER', 'AUDITOR'])
  type!: 'FARM' | 'TRANSPORTER' | 'RETAILER' | 'AUDITOR';
}

export class UpdateOrganizationDto {
  @ApiProperty({ type: String, required: false, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'], required: false })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
