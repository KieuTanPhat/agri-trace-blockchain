import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ChainVersionDto } from './dto.js';

export class ShipmentPlanPayloadDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  transporterOrgId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  retailerOrgId!: string;
  @ApiProperty({
    type: String,
    description: 'Toàn bộ lượng khả dụng, tối đa 3 số lẻ',
    example: '10.000',
  })
  @IsString()
  @Matches(/^\d{1,11}(?:\.\d{1,3})?$/)
  quantity!: string;
  @ApiProperty({ type: String, maxLength: 30 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;
  @ApiProperty({ type: String, maxLength: 2000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  origin!: string;
  @ApiProperty({ type: String, maxLength: 2000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  destination!: string;
  @ApiProperty({ type: String, required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  vehicleRef?: string;
  @ApiProperty({ type: String, required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  plannedPickupTime?: string;
  @ApiProperty({ type: String, required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  expectedArrivalTime?: string;
}
export class CreateShipmentPlanDto extends ShipmentPlanPayloadDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() lotId!: string;
}
export class ReviseShipmentPlanDto extends ShipmentPlanPayloadDto {
  @ApiProperty({ type: Number, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}
export class AcceptShipmentPlanDto {
  @ApiProperty({ enum: ['PRODUCER', 'TRANSPORTER', 'RETAILER'] })
  @IsIn(['PRODUCER', 'TRANSPORTER', 'RETAILER'])
  party!: 'PRODUCER' | 'TRANSPORTER' | 'RETAILER';
  @ApiProperty({ type: Number, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  revision!: number;
  @ApiProperty({ type: String, pattern: '^[0-9a-f]{64}$' })
  @Matches(/^[0-9a-f]{64}$/)
  payloadDigest!: string;
}
export { ChainVersionDto as ShipmentPlanVersionDto };

export class PlanConsentRecordDto {
  @ApiProperty({ enum: ['PRODUCER', 'TRANSPORTER', 'RETAILER'] })
  party!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) acceptedAt!: string;
}
export class PlanRevisionRecordDto {
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: String, format: 'uuid' }) producerOrgId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) transporterOrgId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) retailerOrgId!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) unit!: string;
  @ApiProperty({ type: String }) origin!: string;
  @ApiProperty({ type: String }) destination!: string;
  @ApiProperty({ type: String, nullable: true }) vehicleRef!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  plannedPickupTime!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  expectedArrivalTime!: string | null;
  @ApiProperty({ type: String }) payloadDigest!: string;
  @ApiProperty({ type: [PlanConsentRecordDto] })
  acceptances!: PlanConsentRecordDto[];
}
export class ShipmentPlanRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) lotId!: string;
  @ApiProperty({ enum: ['DRAFT', 'FINALIZED', 'CANCELLED'] }) status!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: Number }) currentRevision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) shipmentId!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: PlanRevisionRecordDto }) current!: PlanRevisionRecordDto;
}
export class PlanAcceptanceResultDto extends PlanConsentRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) planId!: string;
  @ApiProperty({ type: Number }) revision!: number;
}
export class PlanFinalizeResultDto {
  @ApiProperty({ type: String, format: 'uuid' }) planId!: string;
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: String, format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) eventId!: string;
}
