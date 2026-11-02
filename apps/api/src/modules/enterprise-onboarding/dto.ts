import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegistrationDocumentViewDto } from './registration-document.dto.js';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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
  @ApiProperty({ description: 'Whether service payment collection is currently enabled; false allows administrator activation for temporary use without settlement' })
  paymentsEnabled!: boolean;
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
      'PENDING_REVIEW, REJECTED, SELECT_SERVICE, AWAITING_PAYMENT, AWAITING_ACTIVATION or ACTIVE',
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
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewNote!:
    string | null;
}
export class EnterpriseRegistrationReceiptDto {
  @ApiProperty({ format: 'uuid' }) enrollmentId!: string;
  @ApiProperty() status!: string;
}
