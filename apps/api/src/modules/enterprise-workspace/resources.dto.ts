import { ApiProperty } from '@nestjs/swagger';
import { EnterpriseSiteInput, EnterpriseVehicleInput } from './dto.js';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
export class ResourceRevisionInput {
 @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
 @ApiProperty({ maxLength: 1000 }) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}
export class EvidenceWithdrawalInput {
 @ApiProperty({minLength:5,maxLength:500,description:'Why the product photo is no longer shown'}) @IsString() @MinLength(5) @MaxLength(500) reason!:string;
}
export class ProductPhotoOrderInput {
 @ApiProperty({type:[String],format:'uuid',description:'Current product photo ids in display order; the first is the main photo'}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all',{each:true}) order!:string[];
}
export class EvidenceCompletionInput {
 @ApiProperty({minimum:0}) @IsInt() @Min(0) version!:number;
}
export class ProductInput {
 @ApiProperty({maxLength:100}) @IsString() @MinLength(2) @MaxLength(100) category!: string;
 @ApiProperty({format:'uuid'}) @IsUUID() originFarmId!: string;
 @ApiProperty({required:false,type:Number,minimum:0}) @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) price?:number;
 @ApiProperty({maxLength:2000}) @IsString() @MinLength(2) @MaxLength(2000) storageConditions!:string;
 @ApiProperty({maxLength:2000}) @IsString() @MinLength(2) @MaxLength(2000) ingredients!:string;
 @ApiProperty({maxLength:2000}) @IsString() @MinLength(2) @MaxLength(2000) usageInstructions!:string;
 @ApiProperty({required:false,maxLength:2000}) @IsOptional() @IsString() @MaxLength(2000) rawMaterials?: string;
 @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() manufacturingSiteId?: string;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) exporter?: string;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) importer?: string;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) distributor?: string;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) carrier?: string;
 @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() managerUserId?: string;
 @ApiProperty({maxLength:255}) @IsString() @MinLength(1) @MaxLength(255) productName!: string;
 @ApiProperty({maxLength:100}) @IsString() @MinLength(1) @MaxLength(100) sku!: string;
 @ApiProperty({required:false}) @IsOptional() @Matches(/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/) gtin?: string;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) variety?: string;
 @ApiProperty({maxLength:30}) @IsString() @MinLength(1) @MaxLength(30) defaultUnit!: string;
 @ApiProperty({required:false,maxLength:2000}) @IsOptional() @IsString() @MaxLength(2000) description?: string;
}
export class SiteRevisionInput extends ResourceRevisionInput {
 @ApiProperty({type:EnterpriseSiteInput}) @ValidateNested() @Type(()=>EnterpriseSiteInput) site!: EnterpriseSiteInput;
 @ApiProperty({enum:['ACTIVE','INACTIVE']}) @IsIn(['ACTIVE','INACTIVE']) status!:string;
}
export class VehicleRevisionInput extends ResourceRevisionInput {
 @ApiProperty({type:EnterpriseVehicleInput}) @ValidateNested() @Type(()=>EnterpriseVehicleInput) vehicle!: EnterpriseVehicleInput;
 @ApiProperty({enum:['ACTIVE','INACTIVE']}) @IsIn(['ACTIVE','INACTIVE']) status!:string;
}
export class ProductRevisionInput extends ResourceRevisionInput {
 @ApiProperty({type:ProductInput}) @ValidateNested() @Type(() => ProductInput) product!: ProductInput;
 @ApiProperty({enum:['ACTIVE','INACTIVE']}) @IsIn(['ACTIVE','INACTIVE']) status!: 'ACTIVE'|'INACTIVE';
}
export class MaterialInput {
 @ApiProperty({required:false,maxLength:100,description:'Hệ thống tự sinh nếu bỏ trống'}) @IsOptional() @IsString() @MinLength(1) @MaxLength(100) code?: string;
 @ApiProperty({maxLength:255}) @IsString() @MinLength(2) @MaxLength(255) name!: string;
 @ApiProperty({enum:['SEED','FERTILIZER','PROTECTION','OTHER']}) @IsIn(['SEED','FERTILIZER','PROTECTION','OTHER']) kind!: string;
 @ApiProperty({maxLength:30}) @IsString() @MinLength(1) @MaxLength(30) unit!: string;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) supplier?: string;
 @ApiProperty({required:false,maxLength:100}) @IsOptional() @IsString() @MaxLength(100) batchCode?: string;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) activeIngredient?: string;
 @ApiProperty({required:false,maxLength:100}) @ValidateIf((input:MaterialInput)=>input.kind==='SEED') @IsString() @MinLength(2) @MaxLength(100) seedType?: string;
 @ApiProperty({required:false,type:Number,minimum:0}) @IsOptional() @Type(()=>Number) @IsNumber({maxDecimalPlaces:2}) @Min(0) price?: number;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) origin?: string;
 @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) manufacturer?: string;
 @ApiProperty({required:false,maxLength:2000}) @IsOptional() @IsString() @MaxLength(2000) description?: string;
 @ApiProperty({required:false,minimum:0,maximum:3650}) @IsOptional() @IsInt() @Min(0) @Max(3650) withdrawalDays?: number;
 @ApiProperty({required:false,format:'date'}) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString() expiryDate?: string;
}
export class MaterialRevisionInput extends ResourceRevisionInput {
 @ApiProperty({type:MaterialInput}) @ValidateNested() @Type(() => MaterialInput) material!: MaterialInput;
 @ApiProperty({enum:['ACTIVE','INACTIVE']}) @IsIn(['ACTIVE','INACTIVE']) status!: string;
}
export class ProductImportInput {
 @ApiProperty({type:ProductInput,isArray:true}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsObject({each:true}) rows!: ProductInput[];
 @ApiProperty({required:false,description:'Digest returned by preview; required when applying'}) @IsOptional() @Matches(/^[a-f0-9]{64}$/) digest?: string;
}
export class EvidenceInput {
 @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() siteId?: string;
 @ApiProperty({enum:['PRODUCT','FARM','SITE','CYCLE','CYCLE_DRAFT','LOT','TRANSFER','MATERIAL','PROFILE','EXTERNAL_PARTNER','MEMBER','CHAIN','SITE_TRANSFER','QUARANTINE','MATERIAL_RECEIPT','PROCESSING_LOG']}) @IsIn(['PRODUCT','FARM','SITE','CYCLE','CYCLE_DRAFT','LOT','TRANSFER','MATERIAL','PROFILE','EXTERNAL_PARTNER','MEMBER','CHAIN','SITE_TRANSFER','QUARANTINE','MATERIAL_RECEIPT','PROCESSING_LOG']) entityType!: string;
 @ApiProperty({required:false,enum:['OTHER','PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE','PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE','SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','LOT_DOCUMENT','SITE_IMAGE','BUSINESS_LICENSE','TRANSFER_IMAGE','HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO','PARTNERSHIP_EVIDENCE','MEMBER_AVATAR','MEMBER_DOCUMENT','CHAIN_IMAGE','QUARANTINE_IMAGE','RECEIPT_DOCUMENT','PROCESSING_IMAGE']}) @IsOptional() @IsIn(['OTHER','PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE','PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE','SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','LOT_DOCUMENT','SITE_IMAGE','BUSINESS_LICENSE','TRANSFER_IMAGE','HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO','PARTNERSHIP_EVIDENCE','MEMBER_AVATAR','MEMBER_DOCUMENT','CHAIN_IMAGE','QUARANTINE_IMAGE','RECEIPT_DOCUMENT','PROCESSING_IMAGE']) kind?: string;
 @ApiProperty({format:'uuid'}) @IsUUID() entityId!: string;
 @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() supersedesId?: string;
 @ApiProperty({maxLength:1000}) @IsString() @MinLength(10) @MaxLength(1000) description!: string;
 @ApiProperty({required:false,description:'Only source-lot evidence can be public. Must also confirm publication.'}) @IsOptional() @IsBoolean() @Transform(({value})=>value==='true'?true:value==='false'?false:value) public?: boolean;
 @ApiProperty({required:false}) @IsOptional() @IsBoolean() @Transform(({value})=>value==='true'?true:value==='false'?false:value) publicationConfirmed?: boolean;
}
export class EvidenceSubjectQuery {
 @ApiProperty({enum:['PRODUCT','FARM','SITE','CYCLE','CYCLE_DRAFT','LOT','TRANSFER','MATERIAL','PROFILE','EXTERNAL_PARTNER','MEMBER','CHAIN','SITE_TRANSFER','QUARANTINE','MATERIAL_RECEIPT','PROCESSING_LOG']}) @IsIn(['PRODUCT','FARM','SITE','CYCLE','CYCLE_DRAFT','LOT','TRANSFER','MATERIAL','PROFILE','EXTERNAL_PARTNER','MEMBER','CHAIN','SITE_TRANSFER','QUARANTINE','MATERIAL_RECEIPT','PROCESSING_LOG']) entityType!: string;
 @ApiProperty({format:'uuid'}) @IsUUID() entityId!: string;
 @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() siteId?: string;
}
export class EvidenceUploadDocumentation extends EvidenceInput {
 @ApiProperty({type:String,format:'binary'}) file!: string;
}
export class EvidenceContentDto {
 @ApiProperty() fileName!:string;
 @ApiProperty() mediaType!:string;
 @ApiProperty() sha256!:string;
 @ApiProperty({format:'byte'}) contentBase64!:string;
}
