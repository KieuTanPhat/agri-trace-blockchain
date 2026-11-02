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

/** Only enterprises and cooperatives register (ADR-005). */
export const LEGAL_FORMS = ['ENTERPRISE', 'COOPERATIVE'] as const;
export const BUSINESS_ACTIVITIES = [
  'FARM',
  'TRANSPORTER',
  'PROCESSOR',
  'DISTRIBUTOR',
  'RETAILER',
] as const;
/** MEMBER takes part free; CHAIN_OWNER buys a plan and may own chains. */
export const PARTICIPATION_STATUSES = ['MEMBER', 'CHAIN_OWNER'] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];
/** Capabilities under which an organization owns the goods it handles. */
export const GOODS_OWNING = ['FARM', 'PROCESSOR', 'DISTRIBUTOR', 'RETAILER'] as const;
export const mayOwnChains = (activities: readonly string[]) =>
  activities.some((a) => (GOODS_OWNING as readonly string[]).includes(a));
export const chainOwner = (status: string | null | undefined) =>
  status === 'CHAIN_OWNER';
export const SERVICE_PLAN_CODES = [
  'OWNER_START',
  'OWNER_GROWTH',
  'OWNER_SCALE',
  'OWNER_ENTERPRISE',
] as const;
export const PROCESSING_TYPES = [
  'PRELIMINARY',
  'PACKING',
  'DRYING',
  'FREEZING',
  'MILLING',
  'JUICE_EXTRACT',
  'FERMENTING',
  'OTHER',
] as const;
export const REGISTERED_FORMS: readonly string[] = LEGAL_FORMS;
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
/** Required when PROCESSOR is registered. The food-safety certificate is
 * checked by an administrator before the processing capability is approved. */
export class RegistrationProcessingDetails {
  @ApiProperty({ enum: PROCESSING_TYPES, isArray: true, maxItems: 8 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsIn(PROCESSING_TYPES, { each: true })
  processingTypes!: string[];
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  foodSafetyCertificateNumber!: string;
  @ApiProperty({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  foodSafetyCertificateExpiry!: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  facilityCode?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 10000000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000000)
  dailyCapacityKg?: number;
  @ApiProperty({ type: [String], maxItems: 4 })
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(['HACCP', 'ISO22000', 'FSSC22000', 'OTHER'], { each: true })
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
  @ApiPropertyOptional({ enum: SERVICE_PLAN_CODES, description: 'Chain owners only' })
  @IsOptional()
  @IsIn(SERVICE_PLAN_CODES)
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
  @ApiPropertyOptional({ type: RegistrationProcessingDetails })
  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationProcessingDetails)
  processing?: RegistrationProcessingDetails;
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
