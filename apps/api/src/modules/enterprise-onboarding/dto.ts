import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegistrationDocumentViewDto } from './registration-document.dto.js';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const HOSTING_MODES = ['MANAGED_ORG', 'SELF_MANAGED_ORG'] as const;
export class ActivateEnterpriseDto {
 @ApiProperty({minimum:0}) @IsInt() @Min(0) version!:number;
 @ApiProperty({minLength:10,maxLength:1000}) @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @MinLength(10) @MaxLength(1000) reason!:string;
}
export class ReviewEnterpriseDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';
  @ApiProperty({ maxLength: 1000, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}
export class EnterpriseConnectionDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Stable request id retained for retries',
  })
  @IsUUID()
  id!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() chainId!: string;
  @ApiPropertyOptional({
    description: 'DNS name or IP of self-managed peer; no URL or credentials',
  })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  peerHost?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 65535 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  peerPort?: number;
  @ApiPropertyOptional({ description: 'Hostname in the peer TLS certificate' })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  peerServerName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mspId?: string;
  @ApiPropertyOptional({
    description: 'Public TLS root certificate, PEM. Never a private key.',
    maxLength: 16384,
  })
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  tlsCaPem?: string;
}
export class EnterpriseConnectionViewDto {
  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description: 'Submitted public peer settings; never private keys.',
  })
  publicConfig!: Record<string, unknown>;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) chainId!: string;
  @ApiProperty() hostingMode!: string;
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewNote!:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) errorCode!:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) txId!: string | null;
  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    additionalProperties: true,
  })
  evidence!: unknown;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) checkedAt!:
    string | null;
}
export class CapabilityRequestViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    enum: ['FARM', 'TRANSPORTER', 'PROCESSOR', 'DISTRIBUTOR', 'RETAILER', 'AUDITOR'],
  })
  code!: string;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] })
  status!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Production or processing details submitted for this capability',
  })
  details!: Record<string, unknown>;
  @ApiProperty({ type: [String], format: 'uuid' }) evidenceIds!: string[];
  @ApiProperty({ type: String, nullable: true }) reviewNote!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewedAt!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class EnterpriseEnrollmentViewDto {
  @ApiProperty({ enum: ['SINGLE', 'SUPPLY_CHAIN_ENTERPRISE'] })
  participationModel!: string;
  @ApiProperty({
    description:
      'True for producers/cooperatives and supply-chain enterprises, which buy a service plan and may own chains',
  })
  payingParticipant!: boolean;
  @ApiProperty({ type: [CapabilityRequestViewDto] })
  capabilityRequests!: CapabilityRequestViewDto[];
  @ApiProperty({type:String,format:'date-time',nullable:true}) serviceActivatedAt!: string|null;
  @ApiProperty({type:String,nullable:true}) serviceActivationReason!: string|null;
  @ApiProperty({
    description:
      'PENDING_REVIEW, REJECTED, SELECT_SERVICE, AWAITING_PAYMENT, ACTIVE or ACTIVE_LEGACY',
  })
  onboardingStage!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Private submitted legal/contact profile; never public QR data',
  })
  details?: Record<string, unknown> | null;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() organizationName!: string;
  @ApiProperty() organizationType!: string;
  @ApiProperty() representativeName!: string;
  @ApiProperty() representativeEmail!: string;
  @ApiProperty({ type: String, nullable: true }) businessId!: string | null;
  @ApiProperty({ type: [RegistrationDocumentViewDto] })
  documents!: RegistrationDocumentViewDto[];
  @ApiProperty() hostingMode!: string;
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewNote!:
    string | null;
  @ApiProperty({ type: [EnterpriseConnectionViewDto] })
  connections!: EnterpriseConnectionViewDto[];
}
export class EnterpriseRegistrationReceiptDto {
  @ApiProperty({ format: 'uuid' }) enrollmentId!: string;
  @ApiProperty() status!: string;
}
