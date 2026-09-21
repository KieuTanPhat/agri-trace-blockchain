import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateInspectionDto {
  @IsUUID() lotId!: string;
  @IsIn(['PASS', 'FAIL', 'CONDITIONAL'])
  result!: 'PASS' | 'FAIL' | 'CONDITIONAL';
  @IsOptional() @IsString() note?: string;
  @IsDateString() inspectedAt!: string;
  @IsOptional() @IsString() evidenceRef?: string;
}

export class CreateCertificateDto {
  @IsOptional() @IsUUID() lotId?: string;
  @IsOptional() @IsUUID() cycleId?: string;
  @IsString() @MaxLength(120) type!: string;
  @IsString() @MaxLength(255) issuer!: string;
  @IsDateString() issueDate!: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsString() documentRef!: string;
  @IsString() @MaxLength(128) documentHash!: string;
  @IsOptional() @IsBoolean() isPublic?: boolean;
}
