import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
    description: 'Keep only in device secure storage; rotates on every refresh.',
  })
  refreshToken!: string;
  @ApiProperty({ format: 'date-time', type: String }) refreshExpiresAt!: Date;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}
