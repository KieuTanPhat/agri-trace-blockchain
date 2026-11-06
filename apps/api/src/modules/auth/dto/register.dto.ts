import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
import { RegistrationEmailProof } from '../../enterprise-onboarding/registration-otp.dto.js';
import {
  BUSINESS_ACTIVITIES,
  LEGAL_FORMS,
  PARTICIPATION_STATUSES,
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
    enum: BUSINESS_ACTIVITIES,
    isArray: true,
    description:
      'Any number of activities; each is reviewed separately. A chain owner needs at least one goods-owning activity (not only TRANSPORTER).',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsIn(BUSINESS_ACTIVITIES, { each: true })
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
      'Exactly one verified OTP proof for the admin login email. The contact email is not verified by OTP.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
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
    description:
      'Enterprise or cooperative tax identifier. Operator verification remains required.',
    pattern: '^[0-9]{10}(?:-?[0-9]{3})?$',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^\d{10}(?:-?\d{3})?$/)
  businessId!: string;
  @ApiProperty({ enum: BUSINESS_ACTIVITIES })
  @IsIn(BUSINESS_ACTIVITIES)
  organizationType!: (typeof BUSINESS_ACTIVITIES)[number];
  @ApiProperty({
    enum: PARTICIPATION_STATUSES,
    description:
      'MEMBER takes part free of charge; CHAIN_OWNER buys a plan and may own chains. A member may upgrade later.',
  })
  @IsIn(PARTICIPATION_STATUSES)
  participationStatus!: (typeof PARTICIPATION_STATUSES)[number];
  @ApiProperty({
    required: false,
    description: 'Partner invitation token received by email; joins the inviting chain after activation.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  invitationToken?: string;
  @ApiProperty({
    type: EnterpriseRegistrationDetails,
    description:
      'Required five-step registration profile. Province and ward must match the offline administrative catalog.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => EnterpriseRegistrationDetails)
  details!: EnterpriseRegistrationDetails;
}
