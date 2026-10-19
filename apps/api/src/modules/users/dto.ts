import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsByteLength,
  IsIn,
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  ReasonDto,
  TemporaryPasswordField,
  VersionedReasonDto,
} from '../platform-governance/dto.js';

export class CreateUserDto {
  @ApiProperty({ type: String, format: 'email' })
  @IsEmail()
  email!: string;
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;
  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 12,
    maxLength: 72,
    description:
      'At least 12 characters and at most 72 UTF-8 bytes. Passwords are never trimmed or truncated.',
  })
  @IsString()
  @MinLength(12)
  @IsByteLength(12, 72)
  password!: string;
  @ApiProperty({ type: String })
  @IsString()
  roleCode!: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateUserStatusDto extends VersionedReasonDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'LOCKED'] })
  @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED'])
  accountStatus!: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
}

export class UnlockUserDto extends VersionedReasonDto {}

export class RevokeUserSessionsDto extends ReasonDto {}

export class ResetUserPasswordDto extends TemporaryPasswordField {
  @ApiProperty({ type: Number, minimum: 0 })
  @IsInt()
  @Min(0)
  version!: number;
}
