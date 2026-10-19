import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsByteLength,
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  IsOptional,
  IsArray,
  ArrayUnique,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  Equals,
  IsDefined,
  IsUrl,
} from 'class-validator';
import { HOSTING_MODES } from '../../enterprise-onboarding/dto.js';
import { RegistrationEmailProof } from '../../enterprise-onboarding/registration-otp.dto.js';
import {
  LEGAL_FORMS,
  RegistrationProfileExtension,
} from '../../enterprise-onboarding/registration-profile.dto.js';

export class EnterpriseRegistrationDetails extends RegistrationProfileExtension {
  @ApiProperty({ enum: LEGAL_FORMS })
  @IsIn(LEGAL_FORMS)
  legalForm!: string;
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address!: string;
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  province!: string;
  @ApiProperty({ pattern: '^[0-9]{2}$' })
  @Matches(/^[0-9]{2}$/)
  provinceCode!: string;
  @ApiProperty({ pattern: '^[0-9]{5}$' })
  @Matches(/^[0-9]{5}$/)
  wardCode!: string;
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ward!: string;
  @ApiProperty({ maxLength: 30 })
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[ .()-]/g, '') : value,
  )
  @Matches(/^(?:0[35789]\d{8}|02\d{9}|\+84(?:[35789]\d{8}|2\d{9}))$/)
  phone!: string;
  @ApiProperty({ format: 'email' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  contactEmail!: string;
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  representative!: string;
  @ApiProperty({
    enum: ['FARM', 'TRANSPORTER', 'DISTRIBUTOR', 'RETAILER'],
    isArray: true,
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsIn(['FARM', 'TRANSPORTER', 'DISTRIBUTOR', 'RETAILER'], { each: true })
  activities!: string[];
  @ApiProperty({ required: false, maxLength: 255 })
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: true,
  })
  @MaxLength(255)
  website?: string;
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiProperty({ enum: [true] }) @Equals(true) declarationAccepted!: boolean;
}

export class RegisterDto {
  @ApiProperty({
    type: [RegistrationEmailProof],
    description:
      'One or two verified proofs for the admin email and enterprise contact email. One proof if both addresses are identical.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => RegistrationEmailProof)
  emailVerifications!: RegistrationEmailProof[];
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
  @Matches(/^(?=.*\p{L})(?=.*\d)[\s\S]+$/u)
  password!: string;

  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName!: string;
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  organizationName!: string;
  @ApiProperty({
    required: false,
    description:
      'Tax identifier when applicable. Registered entities require it; producer households/individuals may omit it. Operator verification remains required.',
    pattern: '^(?:[0-9]{10}(?:-?[0-9]{3})?|[0-9]{12})$',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{10}(?:-?\d{3})?|\d{12})$/)
  businessId?: string;
  @ApiProperty({ enum: ['FARM', 'TRANSPORTER', 'DISTRIBUTOR', 'RETAILER'] })
  @IsIn(['FARM', 'TRANSPORTER', 'DISTRIBUTOR', 'RETAILER'])
  organizationType!: 'FARM' | 'TRANSPORTER' | 'DISTRIBUTOR' | 'RETAILER';
  @ApiProperty({
    type: EnterpriseRegistrationDetails,
    description:
      'Required five-step registration profile. Province and ward must match the offline administrative catalog.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => EnterpriseRegistrationDetails)
  details!: EnterpriseRegistrationDetails;
  @ApiProperty({ enum: HOSTING_MODES })
  @IsIn(HOSTING_MODES)
  hostingMode!: (typeof HOSTING_MODES)[number];
}
