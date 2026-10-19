import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsByteLength,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsObject,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MIN_REASON_LENGTH } from './platform-config.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Every platform-administration write carries a written justification that is
 * stored in the audit log. */
export class ReasonDto {
  @ApiProperty({
    type: String,
    minLength: MIN_REASON_LENGTH,
    maxLength: 1000,
    description: `Lý do (tối thiểu ${MIN_REASON_LENGTH} ký tự) được ghi vào nhật ký kiểm toán`,
  })
  @Transform(trim)
  @IsString()
  @MinLength(MIN_REASON_LENGTH)
  @MaxLength(1000)
  reason!: string;
}

export class VersionedReasonDto extends ReasonDto {
  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Optimistic version đã đọc; lệch version trả 409',
  })
  @IsInt()
  @Min(0)
  version!: number;
}

export class AuditQueryDto {
  @ApiProperty({ type: String, required: false, format: 'date-time' })
  @IsOptional()
  @IsString()
  from?: string;
  @ApiProperty({ type: String, required: false, format: 'date-time' })
  @IsOptional()
  @IsString()
  to?: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;
  @ApiProperty({ type: String, required: false, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;
  @ApiProperty({ type: String, required: false, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  subjectType?: string;
  @ApiProperty({ type: String, required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  subjectId?: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
  @ApiProperty({
    type: String,
    required: false,
    description: 'Cursor mờ từ nextCursor của trang trước',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  cursor?: string;
  @ApiProperty({ type: Number, required: false, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class EnrollMfaDto {
  @ApiProperty({
    type: String,
    format: 'password',
    maxLength: 72,
    description:
      'Mật khẩu hiện tại: ngăn kẻ giữ access token bị đánh cắp tự gắn thiết bị xác thực',
  })
  @IsString()
  @IsByteLength(1, 72)
  currentPassword!: string;
}

export class MfaCodeDto {
  @ApiProperty({
    type: String,
    minLength: 6,
    maxLength: 20,
    description: 'Mã TOTP 6 số hoặc mã khôi phục dùng một lần',
  })
  @Transform(trim)
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export const APPROVAL_OPERATIONS = [
  'CAPABILITY_GRANT',
  'CREATE_CHAIN_GRANT',
  'SYSTEM_ADMIN_CREATE',
  'CONNECTION_APPROVE',
  'ADMIN_PASSWORD_RESET',
] as const;
export type ApprovalOperation = (typeof APPROVAL_OPERATIONS)[number];

export class ProposeApprovalDto extends ReasonDto {
  @ApiProperty({ enum: APPROVAL_OPERATIONS })
  @IsIn(APPROVAL_OPERATIONS)
  operation!: ApprovalOperation;
  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description:
      'Tham số thao tác. CAPABILITY_GRANT {organizationId, code}; CREATE_CHAIN_GRANT {organizationId, userId}; SYSTEM_ADMIN_CREATE {email, fullName, temporaryPassword}; CONNECTION_APPROVE {connectionId, version, note}; ADMIN_PASSWORD_RESET {userId, temporaryPassword}. Mật khẩu tạm không được lưu dạng rõ.',
  })
  @IsObject()
  params!: Record<string, unknown>;
}

export class DecideApprovalDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';
  @ApiProperty({ type: String, minLength: MIN_REASON_LENGTH, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(MIN_REASON_LENGTH)
  @MaxLength(1000)
  note!: string;
  @ApiProperty({ type: Number, minimum: 0 })
  @IsInt()
  @Min(0)
  version!: number;
}

export class CancelApprovalDto {
  @ApiProperty({ type: String, minLength: MIN_REASON_LENGTH, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(MIN_REASON_LENGTH)
  @MaxLength(1000)
  note!: string;
  @ApiProperty({ type: Number, minimum: 0 })
  @IsInt()
  @Min(0)
  version!: number;
}

export class ApprovalListQueryDto {
  @ApiProperty({
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
    required: false,
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
}

export class TemporaryPasswordField extends ReasonDto {
  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 12,
    maxLength: 72,
    description:
      'Mật khẩu tạm do quản trị viên đặt (12–72 byte UTF-8); tài khoản phải đổi ở lần đăng nhập đầu. Không được ghi vào nhật ký.',
  })
  @IsString()
  @IsByteLength(12, 72)
  temporaryPassword!: string;
}

export class OperationsQueryDto {
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  chainId?: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
  @ApiProperty({
    type: String,
    required: false,
    maxLength: 20,
    description:
      'Lọc trạng thái (outbox: PENDING|PROCESSING|RETRY|COMPLETED|DEAD_LETTER; ledger-jobs: PENDING|PROCESSING|COMPLETED|FAILED; mail: PENDING|SENT|CANCELLED|RETRYING)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
  @ApiProperty({ type: String, required: false, description: 'Cursor mờ' })
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
