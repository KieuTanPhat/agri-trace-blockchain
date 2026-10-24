import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  Max,
  ValidateNested,
} from 'class-validator';
export class TransferLineInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() lotId!: string;
  @ApiProperty({
    type: String,
    description: 'Decimal string, maximum 3 fractional digits',
  })
  @Matches(/^\d{1,11}(\.\d{1,3})?$/)
  quantity!: string;
  @ApiProperty({ maxLength: 30 })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;
}
export class TransferInput {
  @ApiProperty({ type: String, format: 'date-time', description: 'Dự kiến lấy hàng; múi giờ bắt buộc' })
  @IsDateString() plannedPickupAt!: string;
  @ApiProperty({ type: String, required: false, format: 'date-time' })
  @IsOptional() @IsDateString() plannedDeliveryAt?: string;
  @ApiProperty({ type: String, required: false, maxLength: 1000 })
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  senderSiteId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  carrierSiteId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  receiverSiteId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() chainId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() receiverId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() carrierId!: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  origin!: string;
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  destination!: string;
  @ApiProperty({ type: TransferLineInput, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TransferLineInput)
  lines!: TransferLineInput[];
}
export class TransferVersion {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class ConsentRenewInput extends TransferVersion {
 @ApiProperty({maxLength:1000}) @IsString() @MinLength(10) @MaxLength(1000) reason!:string;
}
export class HoldingDispositionInput extends TransferLineInput {
  @ApiProperty({required:false,description:'Only DAMAGE, explicitly consume quarantined stock at a site'}) @IsOptional() @IsBoolean() fromQuarantine?:boolean;
  @ApiProperty({required:false,format:'uuid',description:'Quarantine slip whose open quantity is consumed'}) @IsOptional() @IsUUID() quarantineCaseId?:string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() siteId?: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['SALE', 'DAMAGE'] }) @IsIn(['SALE', 'DAMAGE']) kind!:
    'SALE' | 'DAMAGE';
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
export class SiteAllocationInput extends TransferLineInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() siteId!: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() fromSiteId?: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ maxLength: 1000 }) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}
export const QUARANTINE_CAUSES = ['SUSPECTED_DAMAGE','QUALITY_FAILED','AWAITING_INSPECTION','OTHER'] as const;
export class QuarantineInput extends SiteAllocationInput {
  @ApiProperty({ enum: ['HOLD','RELEASE'] }) @IsIn(['HOLD','RELEASE']) action!: 'HOLD' | 'RELEASE';
  @ApiProperty({ required: false, enum: QUARANTINE_CAUSES, description: 'Required when opening a quarantine slip' })
  @IsOptional() @IsIn(QUARANTINE_CAUSES) cause?: (typeof QUARANTINE_CAUSES)[number];
  @ApiProperty({ required: false, maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ required: false, format: 'uuid', description: 'Quarantine slip being released' })
  @IsOptional() @IsUUID() quarantineCaseId?: string;
}
export class SiteTransferInput extends TransferLineInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() fromSiteId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() toSiteId!: string;
  @ApiProperty({ minimum: 0, description: 'Lot version' }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ maxLength: 1000 }) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @ApiProperty({ required: false, maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ required: false, format: 'uuid', description: 'Member expected to receive the goods' })
  @IsOptional() @IsUUID() receiverUserId?: string;
  @ApiProperty({ required: false, description: 'Dispatch immediately after creating the slip' })
  @IsOptional() @IsBoolean() dispatch?: boolean;
}
export class SiteTransferVersion {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class SiteTransferReceiptInput extends SiteTransferVersion {
  @ApiProperty({ type: String, description: 'Confirmed quantity at the destination, may be zero' })
  @Matches(/^\d{1,11}(\.\d{1,3})?$/) receivedQuantity!: string;
  @ApiProperty({ required: false, maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class SiteTransferResolutionInput extends SiteTransferVersion {
  @ApiProperty({ enum: ['RETURNED','WRITTEN_OFF'], description: 'Return the shortfall to the source site or record it as loss' })
  @IsIn(['RETURNED','WRITTEN_OFF']) resolution!: 'RETURNED' | 'WRITTEN_OFF';
  @ApiProperty({ maxLength: 1000 }) @IsString() @MinLength(10) @MaxLength(1000) note!: string;
}
export class ActualReceiptLine {
  @ApiProperty({ format: 'uuid' }) @IsUUID() lotId!: string;
  @ApiProperty({ description: 'Accepted physical quantity, may be zero' }) @Matches(/^\d{1,11}(\.\d{1,3})?$/) received!: string;
  @ApiProperty({ description: 'Physically rejected quantity remaining with carrier' }) @Matches(/^\d{1,11}(\.\d{1,3})?$/) rejected!: string;
  @ApiProperty({ description: 'Part of received quantity to quarantine' }) @Matches(/^\d{1,11}(\.\d{1,3})?$/) quarantined!: string;
}
export class ActualReceiptInput extends TransferVersion {
  @ApiProperty({ type: ActualReceiptLine, isArray: true }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ActualReceiptLine) lines!: ActualReceiptLine[];
  @ApiProperty({ maxLength: 1000 }) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}
export class ReturnInput extends TransferVersion {
  @ApiProperty({ type: TransferLineInput, isArray: true }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => TransferLineInput) lines!: TransferLineInput[];
  @ApiProperty({ maxLength: 1000 }) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}
export class ReturnSignatureInput extends TransferVersion {
  @ApiProperty({ format: 'uuid' }) @IsUUID() keyRef!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() expiresAt!: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{86}$/) signature!: string;
}
export class DistributionC2Prepare extends TransferVersion {
 @ApiProperty({enum:['CONSENT','PICKUP','DELIVERY','RETURN']}) @IsIn(['CONSENT','PICKUP','DELIVERY','RETURN']) phase!: 'CONSENT'|'PICKUP'|'DELIVERY'|'RETURN';
 @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() returnId?:string;
 @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() keyRef?:string;
}
export class DistributionC2Signature {
 @ApiProperty({format:'uuid'}) @IsUUID() lotId!:string;
 @ApiProperty({format:'uuid'}) @IsUUID() intentId!:string;
 @ApiProperty() @Matches(/^[A-Za-z0-9_-]{86}$/) signature!:string;
}
export class DistributionC2Submit extends DistributionC2Prepare {
 @ApiProperty({type:DistributionC2Signature,isArray:true}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({each:true}) @Type(()=>DistributionC2Signature) signatures!:DistributionC2Signature[];
}
export class TraceNoticeInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() lotId!: string;
  @ApiProperty({ enum: ['WARNING', 'RECALL'] })
  @IsIn(['WARNING', 'RECALL'])
  kind!: 'WARNING' | 'RECALL';
  @ApiProperty({
    maxLength: 500,
    description: 'Public consumer notice; do not include private contact data',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  message!: string;
}
export class TransferObservationInput {
  @ApiProperty({ format: 'date-time' }) @IsDateString() eventTime!: string;
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
  @ApiProperty({
    required: false,
    description: 'Manually observed temperature in °C, not an IoT attestation',
  })
  @IsOptional()
  @Matches(/^-?\d{1,2}(\.\d{1,2})?$/)
  temperature?: string;
}
export class TransferSignature extends TransferVersion {
  @ApiProperty({ enum: ['CONSENT', 'PICKUP', 'DELIVERY'] })
  @IsIn(['CONSENT', 'PICKUP', 'DELIVERY'])
  phase!: 'CONSENT' | 'PICKUP' | 'DELIVERY';
  @ApiProperty({ format: 'uuid' }) @IsUUID() keyRef!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() expiresAt!: string;
  @ApiProperty({ description: 'Ed25519 signature of the canonical challenge' })
  @Matches(/^[A-Za-z0-9_-]{86}$/)
  signature!: string;
}
export class TransferKeyInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  label!: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{59}$/) publicKey!: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{86}$/) popSignature!: string;
}
export class DistributionChallengeDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  snapshot!: Record<string, unknown>;
  @ApiProperty() snapshotDigest!: string;
  @ApiProperty({ description: 'Domain used by canonical signer' })
  domain!: string;
  @ApiProperty({ type: String, isArray: true }) phases!: string[];
}
export class DistributionReportDto {
 @ApiProperty({required:false}) page?:number;
 @ApiProperty({required:false}) pageSize?:number;
 @ApiProperty({required:false}) hasNext?:boolean;
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  lots!: Record<string, unknown>[];
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  transfers!: Record<string, unknown>[];
}
export class DistributionReportQuery {
 @ApiProperty({required:false,minimum:1}) @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page?:number;
 @ApiProperty({required:false,minimum:1,maximum:100}) @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) pageSize?:number;
 @ApiProperty({required:false,maxLength:100}) @IsOptional() @IsString() @MaxLength(100) q?:string;
 @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() siteId?:string;
 @ApiProperty({required:false,format:'date'}) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString() expiryBefore?:string;
}
export class DistributionTasksDto {
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true, description: 'Transfer actions waiting on this organization within the caller scope' })
  transfers!: Record<string, unknown>[];
  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true, description: 'Held lots that are recalled, expired, expiring within 7 days or quarantined' })
  stock!: Record<string, unknown>[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  counts!: Record<string, number>;
}
export class DistributionOptionsDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  items!: Record<string, unknown>[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  vehicles!: Record<string, unknown>[];
}
