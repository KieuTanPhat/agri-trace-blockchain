import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ComplianceCorrectionDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supersedesId?: string;
  @ApiProperty({ required: false, minLength: 1, maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  correctionReason?: string;
}

export class CreateInspectionDto extends ComplianceCorrectionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  lotId!: string;
  @ApiProperty({ enum: ['PASS', 'FAIL', 'CONDITIONAL'] })
  @IsIn(['PASS', 'FAIL', 'CONDITIONAL'])
  result!: 'PASS' | 'FAIL' | 'CONDITIONAL';
  @ApiProperty({ type: String, required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  inspectedAt!: string;
  @ApiProperty({ type: String, required: false, maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  evidenceRef?: string;
}

export class CreateCertificateDto extends ComplianceCorrectionDto {
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lotId?: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cycleId?: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  type!: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  issuer!: string;
  @ApiProperty({ type: String })
  @IsDateString()
  issueDate!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 2048 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  documentRef!: string;
  @ApiProperty({
    type: String,
    pattern: '^[a-f0-9]{64}$',
    minLength: 64,
    maxLength: 64,
  })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  documentHash!: string;
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class ReviewCertificateDto {
  @ApiProperty({ type: Number, minimum: 0, maximum: 2147483647 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  version!: number;
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';
  @ApiProperty({ type: String, required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
