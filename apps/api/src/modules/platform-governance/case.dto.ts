import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const CASE_CATEGORIES = [
  'QUALITY',
  'SAFETY',
  'LABELING',
  'COUNTERFEIT',
  'OTHER',
] as const;
export const CASE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const CASE_SOURCES = [
  'CONSUMER',
  'ENTERPRISE',
  'AUDITOR',
  'INTERNAL',
] as const;
export const CASE_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'ACKNOWLEDGED',
  'RESPONDED',
  'ESCALATED',
  'CLOSED',
] as const;

const note = (min: number, max = 2000) => ({
  type: String,
  minLength: min,
  maxLength: max,
});

export class CreateCaseDto {
  @ApiProperty({ ...note(5, 200) })
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  title!: string;
  @ApiProperty({
    ...note(10, 4000),
    description:
      'Hiển thị cho tổ chức được giao: không ghi dữ liệu cá nhân của người khiếu nại',
  })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;
  @ApiProperty({ enum: CASE_CATEGORIES })
  @IsIn(CASE_CATEGORIES)
  category!: (typeof CASE_CATEGORIES)[number];
  @ApiProperty({ enum: CASE_SEVERITIES })
  @IsIn(CASE_SEVERITIES)
  severity!: (typeof CASE_SEVERITIES)[number];
  @ApiProperty({ enum: CASE_SOURCES })
  @IsIn(CASE_SOURCES)
  source!: (typeof CASE_SOURCES)[number];
  @ApiProperty({
    type: String,
    format: 'uuid',
    required: false,
    description:
      'Lô liên quan; nếu không chỉ định chủ sở hữu, giao cho doanh nghiệp sản xuất lô',
  })
  @IsOptional()
  @IsUUID()
  lotId?: string;
  @ApiProperty({ type: String, format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  ownerOrganizationId?: string;
  @ApiProperty({ type: String, format: 'date-time', required: false })
  @IsOptional()
  @IsISO8601()
  responseDueAt?: string;
}

class VersionedDto {
  @ApiProperty({ type: Number, minimum: 0 })
  @IsInt()
  @Min(0)
  version!: number;
}

export class ClassifyCaseDto extends VersionedDto {
  @ApiProperty({ enum: CASE_CATEGORIES })
  @IsIn(CASE_CATEGORIES)
  category!: (typeof CASE_CATEGORIES)[number];
  @ApiProperty({ enum: CASE_SEVERITIES })
  @IsIn(CASE_SEVERITIES)
  severity!: (typeof CASE_SEVERITIES)[number];
  @ApiProperty({ ...note(10) })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  note!: string;
}

export class AssignCaseDto extends VersionedDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  ownerOrganizationId!: string;
  @ApiProperty({ type: String, format: 'date-time', required: false })
  @IsOptional()
  @IsISO8601()
  responseDueAt?: string;
  @ApiProperty({ ...note(10) })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  note!: string;
}

export class LinkCaseLotDto extends VersionedDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  lotId!: string;
  @ApiProperty({ ...note(10) })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  note!: string;
}

export class CaseNoteDto {
  @ApiProperty({ ...note(1) })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;
  @ApiProperty({
    enum: ['INTERNAL', 'SHARED'],
    required: false,
    description: 'Mặc định INTERNAL; SHARED chỉ khi đã giao cho tổ chức',
  })
  @IsOptional()
  @IsIn(['INTERNAL', 'SHARED'])
  visibility?: 'INTERNAL' | 'SHARED';
}

export class EscalateCaseDto extends VersionedDto {
  @ApiProperty({ ...note(10) })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  note!: string;
}

export class CloseCaseDto extends VersionedDto {
  @ApiProperty({ ...note(10), description: 'Lý do đóng, ghi vào lịch sử' })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}

export class EnterpriseCaseResponseDto extends VersionedDto {
  @ApiProperty({ ...note(10) })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  note!: string;
}

export class EnterpriseCaseAckDto extends VersionedDto {
  @ApiProperty({ ...note(1), required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note?: string;
}

export class CaseListQueryDto {
  @ApiProperty({ enum: CASE_STATUSES, required: false })
  @IsOptional()
  @IsIn(CASE_STATUSES)
  status?: (typeof CASE_STATUSES)[number];
  @ApiProperty({ enum: CASE_SEVERITIES, required: false })
  @IsOptional()
  @IsIn(CASE_SEVERITIES)
  severity?: (typeof CASE_SEVERITIES)[number];
  @ApiProperty({
    type: String,
    enum: ['true'],
    required: false,
    description: 'true: quá hạn phản hồi',
  })
  @IsOptional()
  @IsIn(['true'])
  overdue?: 'true';
  @ApiProperty({ type: String, format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  cursor?: string;
  @ApiProperty({ type: Number, required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
