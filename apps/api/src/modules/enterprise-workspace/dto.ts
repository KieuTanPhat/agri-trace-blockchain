import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsByteLength,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ENTERPRISE_PERMISSIONS } from './enterprise-policy.js';

export class EnterpriseRoleInput {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;
  @ApiProperty({ enum: ENTERPRISE_PERMISSIONS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(40)
  @IsIn(ENTERPRISE_PERMISSIONS, { each: true })
  permissions!: string[];
  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}
export class MemberRoleInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() roleId!: string;
  @ApiProperty({ type: String, isArray: true, format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  chainIds!: string[];
  @ApiProperty({ type: String, isArray: true, format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  siteIds!: string[];
}
export class EnterpriseMemberInput {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName!: string;
  @ApiProperty({ maxLength: 255 }) @IsString() @MinLength(2) @MaxLength(255) jobTitle!: string;
  @ApiProperty({ required: false, maxLength: 30 }) @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() workSiteId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() responsibleFarmId?: string;
  @ApiProperty({ required: false, maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) contactAddress?: string;
  @ApiProperty({ required: false, maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) memberNote?: string;
  @ApiProperty({ format: 'email' }) @IsEmail() @MaxLength(255) email!: string;
  @ApiProperty({ format: 'password', minLength: 12, maxLength: 72 })
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  @IsByteLength(12, 72)
  password!: string;
  @ApiProperty({ enum: [2, 3] }) @IsIn([2, 3]) tier!: number;
  @ApiProperty({ type: MemberRoleInput, isArray: true })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MemberRoleInput)
  roles!: MemberRoleInput[];
}
export class MemberSupervisorInput {
  @ApiProperty({ minimum: 0, description: 'Member enterpriseRevision the change is based on' }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ format: 'uuid', nullable: true, description: 'Active tier-2 manager; null puts the member directly under the owner' })
  @IsOptional() @IsUUID() supervisorId?: string | null;
}
export class EnterpriseMemberUpdate {
  @ApiProperty({ required: false, maxLength: 255 }) @IsOptional() @IsString() @MinLength(2) @MaxLength(255) jobTitle?: string;
  @ApiProperty({ required: false, maxLength: 30, nullable: true }) @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @ApiProperty({ required: false, format: 'uuid', nullable: true }) @IsOptional() @IsUUID() workSiteId?: string | null;
  @ApiProperty({ required: false, format: 'uuid', nullable: true }) @IsOptional() @IsUUID() responsibleFarmId?: string | null;
  @ApiProperty({ required: false, maxLength: 500, nullable: true }) @IsOptional() @IsString() @MaxLength(500) contactAddress?: string | null;
  @ApiProperty({ required: false, maxLength: 1000, nullable: true }) @IsOptional() @IsString() @MaxLength(1000) memberNote?: string | null;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['ACTIVE', 'LOCKED'] })
  @IsIn(['ACTIVE', 'LOCKED'])
  status!: 'ACTIVE' | 'LOCKED';
  @ApiProperty({ type: MemberRoleInput, isArray: true })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MemberRoleInput)
  roles!: MemberRoleInput[];
}
export class EnterprisePartnerInput {
  @ApiProperty({ description: 'Mã tổ chức AGT (không cần MST), hoặc mã doanh nghiệp cũ' })
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9-]{4,39}$/)
  businessId!: string;
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class EnterpriseExternalPartnerInput {
  @ApiProperty({ maxLength: 40 }) @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{4,39}$/) businessId!: string;
  @ApiProperty({ maxLength: 255 }) @IsString() @MinLength(2) @MaxLength(255) name!: string;
  @ApiProperty({ enum: ['FARM','TRANSPORTER','DISTRIBUTOR','RETAILER'] }) @IsIn(['FARM','TRANSPORTER','DISTRIBUTOR','RETAILER']) kind!: string;
  @ApiProperty({ maxLength: 500 }) @IsString() @MinLength(5) @MaxLength(500) address!: string;
  @ApiProperty({ required: false, maxLength: 30 }) @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiProperty({ required: false, format: 'email' }) @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @ApiProperty({ required: false, maxLength: 40 }) @IsOptional() @IsString() @MaxLength(40) taxCode?: string;
  @ApiProperty({ required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) representative?: string;
  @ApiProperty({ required: false, maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class EnterprisePartnerDecision {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['ACCEPT', 'REJECT', 'REVOKE'] })
  @IsIn(['ACCEPT', 'REJECT', 'REVOKE'])
  decision!: 'ACCEPT' | 'REJECT' | 'REVOKE';
}
export class EnterpriseSiteInput {
  @ApiProperty({required:false,format:'uuid',description:'Existing farm identity for a production site'}) @IsOptional() @IsUUID() farmId?:string;
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;
  @ApiProperty({
    enum: ['PRODUCTION', 'PACKING', 'WAREHOUSE', 'COLD_STORAGE', 'PROCESSING', 'DISTRIBUTION', 'RETAIL', 'OTHER'],
  })
  @IsIn(['PRODUCTION', 'PACKING', 'WAREHOUSE', 'COLD_STORAGE', 'PROCESSING', 'DISTRIBUTION', 'RETAIL', 'OTHER'])
  kind!: string;
  @ApiProperty({maxLength:255}) @IsString() @MinLength(2) @MaxLength(255) region!: string;
  @ApiProperty({maxLength:255}) @IsString() @MinLength(2) @MaxLength(255) ward!: string;
  @ApiProperty({type:Number,minimum:0,exclusiveMinimum:true}) @Type(()=>Number) @IsNumber({maxDecimalPlaces:2}) @IsPositive() areaM2!:number;
  @ApiProperty({required:false,type:Number,minimum:0,exclusiveMinimum:true}) @IsOptional() @Type(()=>Number) @IsNumber({maxDecimalPlaces:2}) @IsPositive() coldAreaM2?:number;
  @ApiProperty({required:false,type:Number,minimum:0,exclusiveMinimum:true}) @IsOptional() @Type(()=>Number) @IsNumber({maxDecimalPlaces:3}) @IsPositive() capacityKg?:number;
  @ApiProperty({required:false,type:Number,minimum:0,exclusiveMinimum:true}) @IsOptional() @Type(()=>Number) @IsNumber({maxDecimalPlaces:3}) @IsPositive() expectedOutputTons?:number;
  @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) manager?:string;
  @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) representative?:string;
  @ApiProperty({required:false,maxLength:30}) @IsOptional() @IsString() @MaxLength(30) phone?:string;
  @ApiProperty({required:false,format:'email'}) @IsOptional() @IsEmail() email?:string;
  @ApiProperty({required:false,maxLength:2000}) @IsOptional() @IsString() @MaxLength(2000) otherInfo?:string;
  @ApiProperty({required:false,format:'uuid',description:'Active member of the organization in charge of the site'}) @IsOptional() @IsUUID() staffUserId?:string;
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address!: string;
}
export class EnterpriseVehicleInput {
  @ApiProperty({ maxLength: 40 })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  registration!: string;
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  kind!: string;
}
export class ResourceStatusInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: string;
}
export class WorkspaceRecordDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Private organization record. Passwords, sessions and signing keys are excluded.',
  })
  record!: Record<string, unknown>;
}
export class WorkspaceListDto {
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  items!: Record<string, unknown>[];
}
