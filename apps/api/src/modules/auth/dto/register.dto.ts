import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsByteLength,
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { HOSTING_MODES } from '../../enterprise-onboarding/dto.js';

export class RegisterDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Retain this id and the original form for retries.',
  })
  @IsUUID()
  requestId!: string;
  @ApiProperty({ format: 'email', maxLength: 255 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    format: 'password',
    minLength: 12,
    maxLength: 72,
    description:
      'At least 12 characters, at most 72 UTF-8 bytes; never trimmed.',
  })
  @IsString()
  @MinLength(12)
  @IsByteLength(12, 72)
  password!: string;

  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  organizationName!: string;
  @ApiProperty({
    description:
      'Business/tax identifier; checked by operator before admission.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9-]{4,39}$/)
  businessId!: string;
  @ApiProperty({ enum: ['FARM', 'TRANSPORTER', 'RETAILER'] })
  @IsIn(['FARM', 'TRANSPORTER', 'RETAILER'])
  organizationType!: 'FARM' | 'TRANSPORTER' | 'RETAILER';
  @ApiProperty({ enum: HOSTING_MODES })
  @IsIn(HOSTING_MODES)
  hostingMode!: (typeof HOSTING_MODES)[number];
}
