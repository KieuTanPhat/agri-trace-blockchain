import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const RIGHTS = [
  'ACCESS',
  'CORRECTION',
  'DELETION',
  'RESTRICTION',
  'WITHDRAWAL',
  'OBJECTION',
] as const;
export class CreatePrivacyRequestDto {
  @ApiProperty({ enum: RIGHTS }) @IsIn(RIGHTS) requestType!: string;
  @ApiProperty({
    minLength: 10,
    maxLength: 4000,
    description: 'Nội dung riêng tư; không nhập mật khẩu, OTP hoặc khóa ký',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string;
}
export class CreatePrivacyBreachDto {
  @ApiProperty({
    format: 'date-time',
    description:
      'Thời điểm phát hiện; đồng hồ 72 giờ bắt đầu ở đây và không thể sửa',
  })
  @IsISO8601()
  detectedAt!: string;
  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string;
}
export class UpdatePrivacyTicketDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['IN_REVIEW', 'RESPONDED', 'CLOSED', 'REJECTED'] })
  @IsIn(['IN_REVIEW', 'RESPONDED', 'CLOSED', 'REJECTED'])
  status!: string;
  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  note!: string;
  @ApiProperty({
    enum: ['INTERNAL', 'SHARED'],
    default: 'INTERNAL',
    required: false,
  })
  @IsOptional()
  @IsIn(['INTERNAL', 'SHARED'])
  visibility?: string;
  @ApiProperty({
    enum: ['UNASSESSED', 'REQUIRED', 'NOT_REQUIRED'],
    required: false,
  })
  @IsOptional()
  @IsIn(['UNASSESSED', 'REQUIRED', 'NOT_REQUIRED'])
  reporting?: string;
  @ApiProperty({ format: 'date-time', required: false })
  @IsOptional()
  @IsISO8601()
  reportedAt?: string;
  @ApiProperty({
    required: false,
    minLength: 5,
    maxLength: 500,
    description:
      'Mã/tham chiếu bằng chứng đã thông báo bên ngoài; không tự gửi báo cáo',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  notificationReference?: string;
}
export class PrivacyQueryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
export class PrivacyTicketDto {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() requestType!: string;
  @ApiProperty() status!: string;
  @ApiProperty() reporting!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  detectedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deadlineAt!: Date | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  reportedAt!: Date | null;
  @ApiProperty() overdue!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}
export class PrivacyPageDto {
  @ApiProperty({ type: [PrivacyTicketDto] }) items!: PrivacyTicketDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class PrivacyEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() action!: string;
  @ApiProperty() visibility!: string;
  @ApiProperty() note!: string;
  @ApiProperty({ type: String, nullable: true }) notificationReference!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}
export class PrivacyDetailDto extends PrivacyTicketDto {
  @ApiProperty() message!: string;
  @ApiProperty({ type: [PrivacyEventDto] }) events!: PrivacyEventDto[];
}
