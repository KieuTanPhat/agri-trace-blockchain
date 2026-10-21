import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsByteLength,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class MobilePhoneDto {
  @ApiProperty({
    description: 'Vietnam phone, normalized to E.164',
    maxLength: 16,
  })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().replace(/^0(?=\d{9}$)/, '+84')
      : value,
  )
  @Matches(/^\+84\d{9}$/)
  phone!: string;
}
export class MobileLoginDto extends MobilePhoneDto {
  @ApiProperty({ format: 'password', maxLength: 72 })
  @IsString()
  @MinLength(1)
  @IsByteLength(1, 72)
  password!: string;
  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(1024)
  previousRefreshToken?: string;
}
export class MobileRefreshDto {
  @ApiProperty({ minLength: 32, maxLength: 1024 })
  @IsString()
  @MinLength(32)
  @MaxLength(1024)
  refreshToken!: string;
}
export class MobileProofDto extends MobilePhoneDto {
  @ApiProperty({
    minLength: 100,
    maxLength: 8192,
    description:
      'Fresh phone-provider Firebase ID token; never logged or persisted raw',
  })
  @IsString()
  @MinLength(100)
  @MaxLength(8192)
  firebaseIdToken!: string;
}
export class MobileRegisterDto extends MobileProofDto {
  @ApiProperty({ format: 'password', minLength: 12, maxLength: 72 })
  @IsString()
  @MinLength(12)
  @IsByteLength(12, 72)
  password!: string;
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;
  @ApiPropertyOptional({ maxLength: 255, format: 'email' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;
  @ApiProperty({ maxLength: 10 })
  @IsString()
  @Matches(/^\d{1,10}$/)
  provinceCode!: string;
  @ApiProperty({ maxLength: 10 })
  @IsString()
  @Matches(/^\d{1,10}$/)
  wardCode!: string;
  @ApiPropertyOptional({ maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(255)
  businessAddress?: string;
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  consentVersion!: string;
}
export class MobileResetDto extends MobileProofDto {
  @ApiProperty({ format: 'password', minLength: 12, maxLength: 72 })
  @IsString()
  @MinLength(12)
  @IsByteLength(12, 72)
  newPassword!: string;
}
export class ConsumerProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty() phone!: string;
  @ApiPropertyOptional() contactEmail?: string;
  @ApiProperty() province!: string;
  @ApiProperty() ward!: string;
  @ApiPropertyOptional() businessAddress?: string;
}
export class MobileSessionDto {
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty() accessToken!: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ format: 'date-time', type: String }) refreshExpiresAt!: Date;
  @ApiProperty({ type: ConsumerProfileDto }) user!: ConsumerProfileDto;
}
export class MobileResetResultDto {
  @ApiProperty({ enum: [true] }) reset!: boolean;
}
export class MobileLogoutResultDto {
  @ApiProperty({ enum: [true] }) revoked!: boolean;
}
