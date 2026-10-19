import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { VersionedReasonDto } from '../platform-governance/dto.js';

export class CreateOrganizationDto {
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @ApiProperty({
    enum: ['AUDITOR'],
    description:
      'Only independent auditor organizations can be provisioned by platform administrators. Enterprises use reviewed registration.',
  })
  @IsIn(['AUDITOR'])
  type!: 'AUDITOR';
}

export class UpdateOrganizationDto extends VersionedReasonDto {
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
