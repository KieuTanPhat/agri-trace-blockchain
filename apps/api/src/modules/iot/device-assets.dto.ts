import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class RegisterTransportDeviceDto {
  @ApiProperty({ type: String, maxLength: 120 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  deviceCode!: string;
  @ApiProperty({ type: String, maxLength: 255 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  name!: string;
  @ApiProperty({ enum: ['WOKWI_SIMULATED'] })
  @IsIn(['WOKWI_SIMULATED'])
  sourceType!: 'WOKWI_SIMULATED';
}
export class DeviceVersionDto {
  @ApiProperty({ type: Number, minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class DeviceStatusDto extends DeviceVersionDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}
export class IssueDeviceCredentialDto extends DeviceVersionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  credentialId!: string;
  @ApiProperty({
    type: String,
    pattern: '^[a-f0-9]{64}$',
    description:
      'SHA-256 of UTF-8 base64url secret text; never send the secret',
  })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  @MaxLength(64)
  verifier!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Future expiry no later than two hours after issuance',
  })
  @IsDateString()
  expiresAt!: string;
}
export class DeviceCredentialMetadataDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) deviceId!: string;
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt!: string | null;
}
export class CredentialMutationDto {
  @ApiProperty({ type: DeviceCredentialMetadataDto })
  credential!: DeviceCredentialMetadataDto;
  @ApiProperty({ type: Number }) deviceVersion!: number;
  @ApiProperty({ type: Number }) authorityRevision!: number;
}
