import {
  IsByteLength,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @IsEmail()
  @ApiProperty({ format: 'email', maxLength: 255 })
  @MaxLength(255)
  email!: string;

  @IsString()
  @ApiProperty({
    format: 'password',
    maxLength: 72,
    description:
      'At most 72 UTF-8 bytes. Passwords are never trimmed or truncated.',
  })
  @MaxLength(72)
  @IsByteLength(0, 72)
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  @ApiProperty({
    type: String,
    required: false,
    minLength: 6,
    maxLength: 20,
    description:
      'Mã TOTP hoặc mã khôi phục. Bắt buộc khi quản trị viên đã bật MFA; thiếu mã trả 401 "Cần mã xác thực hai yếu tố".',
  })
  mfaCode?: string;
}
