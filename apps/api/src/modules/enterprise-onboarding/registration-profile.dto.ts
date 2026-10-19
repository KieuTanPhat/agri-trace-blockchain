import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayContains,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const LEGAL_FORMS = [
  'ENTERPRISE',
  'COOPERATIVE',
  'HOUSEHOLD_BUSINESS',
  'PRODUCER_HOUSEHOLD',
  'INDIVIDUAL_PRODUCER',
] as const;
export const REGISTERED_FORMS = [
  'ENTERPRISE',
  'COOPERATIVE',
  'HOUSEHOLD_BUSINESS',
];
export const DOCUMENT_KINDS = [
  'LOGO',
  'LEGAL_REGISTRATION',
  'AUTHORIZATION',
  'CERTIFICATE',
] as const;
export const REGISTRATION_POLICY_VERSION = 'agritrace-registration-2026-10-18';
export class RegistrationProductionDetails {
  @ApiProperty({ enum: ['CROP'] }) @IsIn(['CROP']) sector!: string;
  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  productGroups!: string[];
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  growingAreaCode?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  packingFacilityCode?: string;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  scaleEstimate?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  facilityCount?: number;
  @ApiProperty({ type: [String], maxItems: 4 })
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(['VIETGAP', 'GLOBALGAP', 'ORGANIC', 'OTHER'], { each: true })
  certifications!: string[];
}
export class RegistrationServicePreferences {
  @ApiProperty({
    type: [String],
    enum: ['TRACEABILITY', 'QR_LABELS'],
    minItems: 1,
    maxItems: 2,
    description: 'TRACEABILITY is required; QR_LABELS is optional.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  @ArrayContains(['TRACEABILITY'])
  @IsIn(['TRACEABILITY', 'QR_LABELS'], { each: true })
  interests!: string[];
  @ApiPropertyOptional({ enum: ['TRACE_5', 'TRACE_10', 'TRACE_20'] })
  @IsOptional()
  @IsIn(['TRACE_5', 'TRACE_10', 'TRACE_20'])
  planCode?: string;
  @ApiProperty({ enum: ['UP_TO_10', 'UP_TO_100', 'OVER_100', 'UNDECIDED'] })
  @IsIn(['UP_TO_10', 'UP_TO_100', 'OVER_100', 'UNDECIDED'])
  expectedProducts!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 1000000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  expectedLotsPerMonth?: number;
  @ApiProperty({ enum: ['YES', 'LATER'] })
  @IsIn(['YES', 'LATER'])
  partnerIntent!: string;
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  integrationNotes?: string;
}
export class RegistrationProfileExtension {
  @ApiProperty({ enum: [2] }) @Equals(2) formVersion!: number;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;
  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  establishedDate?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  representativeTitle?: string;
  @ApiProperty({ enum: ['REPRESENTATIVE', 'AUTHORIZED'] })
  @IsIn(['REPRESENTATIVE', 'AUTHORIZED'])
  registrantRelationship!: string;
  @ApiPropertyOptional({ type: RegistrationProductionDetails })
  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationProductionDetails)
  production?: RegistrationProductionDetails;
  @ApiProperty({ type: RegistrationServicePreferences })
  @IsDefined()
  @ValidateNested()
  @Type(() => RegistrationServicePreferences)
  services!: RegistrationServicePreferences;
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 8 })
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    { each: true },
  )
  documentIds!: string[];
  @ApiProperty({ enum: [true] }) @Equals(true) termsAccepted!: boolean;
  @ApiProperty({ enum: [true] }) @Equals(true) privacyAcknowledged!: boolean;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  marketingAccepted?: boolean;
}
