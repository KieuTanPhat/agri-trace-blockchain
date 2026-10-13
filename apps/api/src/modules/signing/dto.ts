import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RegisterSigningKeyDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Mã khóa do bên giữ khóa tự sinh; nằm trong bằng chứng sở hữu',
  })
  @IsUUID()
  keyRef!: string;

  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @ApiProperty({
    type: String,
    description: 'Khóa công khai Ed25519, SPKI DER mã hóa base64url (59 ký tự)',
  })
  @Matches(/^[A-Za-z0-9_-]{59}$/)
  publicKey!: string;

  @ApiProperty({
    type: String,
    description:
      'Chữ ký Ed25519 (base64url, 86 ký tự) của khóa trên thông điệp proof-of-possession',
  })
  @Matches(/^[A-Za-z0-9_-]{86}$/)
  popSignature!: string;
}

export class RevokeSigningKeyDto {
  @ApiProperty({ type: String, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class SigningKeyDto {
  @ApiProperty({ type: String, format: 'uuid' }) keyRef!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: String }) algorithm!: string;
  @ApiProperty({ type: String }) publicKey!: string;
  @ApiProperty({ enum: ['PENDING_LEDGER', 'ACTIVE', 'REVOKED'] })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  activatedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt!: string | null;
}

export class SigningContextDto {
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Binding ledger hiện hoạt của chuỗi; null nếu chưa có',
  })
  bindingDigest!: string | null;
  @ApiProperty({ enum: ['STANDARD', 'DUAL_SIGNED'] }) handoverMode!: string;
  @ApiProperty({ type: SigningKeyDto, isArray: true })
  keys!: SigningKeyDto[];
}

export class PrepareIntentOptionsDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    required: false,
    description: 'Chọn khóa khi tổ chức có nhiều khóa hoạt động',
  })
  @IsOptional()
  @IsUUID()
  keyRef?: string;

  @ApiProperty({
    type: Number,
    required: false,
    minimum: 5,
    maximum: 1440,
    description: 'Thời gian chờ chữ ký, mặc định 15 phút',
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  signingWindowMinutes?: number;
}

export class SubmitSignatureDto {
  @ApiProperty({
    type: String,
    description: 'Chữ ký Ed25519 base64url (86 ký tự) trên signedMessage',
  })
  @Matches(/^[A-Za-z0-9_-]{86}$/)
  signature!: string;
}

export class SigningIntentDto {
  @ApiProperty({ type: String, format: 'uuid' }) intentId!: string;
  @ApiProperty({ enum: ['HANDOVER_OFFER', 'HANDOVER_CONFIRM'] })
  operation!: string;
  @ApiProperty({ type: String }) entityType!: string;
  @ApiProperty({ type: String, format: 'uuid' }) entityId!: string;
  @ApiProperty({ type: String }) eventType!: string;
  @ApiProperty({ type: String, format: 'uuid' }) keyRef!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Intent đầy đủ; mọi giá trị là chuỗi để canonical hóa độc lập',
  })
  intent!: Record<string, string>;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Nội dung nghiệp vụ mà payloadDigest cam kết',
  })
  payload!: Record<string, string>;
  @ApiProperty({ type: String }) intentDigest!: string;
  @ApiProperty({
    type: String,
    description:
      'Đúng các byte khóa phải ký (base64url); bên ký nên tự tính lại',
  })
  signedMessage!: string;
}
