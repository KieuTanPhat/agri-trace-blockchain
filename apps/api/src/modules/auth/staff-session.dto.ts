import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsByteLength,
  IsEmail,
  IsUUID,
  Matches,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuthUserDto } from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';

export class StaffLoginDto extends LoginDto {
  @ApiPropertyOptional({
    maxLength: 1024,
    description:
      'Refresh token of the session this device held; its family is revoked first.',
  })
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(1024)
  previousRefreshToken?: string;
}

export class StaffSessionDto {
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty() accessToken!: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: string;
  @ApiProperty({
    description:
      'Keep only in device secure storage; rotates on every refresh.',
  })
  refreshToken!: string;
  @ApiProperty({ format: 'date-time', type: String }) refreshExpiresAt!: Date;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}

export class StaffPasswordResetRequestDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Client-generated ID; retry a lost response with the same ID and email',
  })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ format: 'email', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
export class StaffPasswordResetVerifyDto extends StaffPasswordResetRequestDto {
  @ApiProperty({ pattern: '^[0-9]{6}$' })
  @Matches(/^[0-9]{6}$/)
  code!: string;
}
export class StaffPasswordResetVerifyResultDto {
  @ApiProperty({ description: 'Short-lived proof; keep in memory only' })
  resetToken!: string;
  @ApiProperty({ example: 300 }) expiresInSeconds!: number;
}
export class StaffPasswordResetConfirmDto extends StaffPasswordResetRequestDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  resetToken!: string;

  @ApiProperty({ format: 'password', minLength: 12, maxLength: 72 })
  @IsString()
  @MinLength(12)
  @IsByteLength(12, 72)
  newPassword!: string;
}
export class StaffPasswordResetRequestResultDto {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ example: 60 }) resendAfterSeconds!: number;
  @ApiProperty({ example: 600 }) expiresInSeconds!: number;
}
export class StaffPasswordResetResultDto {
  @ApiProperty({ example: true }) changed!: boolean;
}
