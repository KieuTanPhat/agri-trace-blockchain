import { ApiProperty } from '@nestjs/swagger';
import { ROLE_CODES } from '../role-codes.js';

class AuthRoleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ROLE_CODES }) code!: string;
  @ApiProperty() name!: string;
}

class AuthOrganizationDto {
  @ApiProperty() status!: string;
}

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  organizationId!: string | null;
  @ApiProperty({ type: AuthOrganizationDto, nullable: true })
  organization!: AuthOrganizationDto | null;
  @ApiProperty({ type: AuthRoleDto }) role!: AuthRoleDto;
  @ApiProperty() accountStatus!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

class AuthSessionDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Refresh session family identifier; not a credential',
  })
  sessionId!: string;
  @ApiProperty() accessToken!: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: string;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}

class AuthEnvelopeDto {
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty() requestId!: string;
}

export class AuthSessionResponseDto extends AuthEnvelopeDto {
  @ApiProperty({ enum: [true] }) success!: boolean;
  @ApiProperty({ type: AuthSessionDto }) data!: AuthSessionDto;
}

export class AuthProfileResponseDto extends AuthEnvelopeDto {
  @ApiProperty({ enum: [true] }) success!: boolean;
  @ApiProperty({ type: AuthUserDto }) data!: AuthUserDto;
}

class RevocationDto {
  @ApiProperty({ enum: [true] }) revoked!: boolean;
}

export class AuthLogoutResponseDto extends AuthEnvelopeDto {
  @ApiProperty({ enum: [true] }) success!: boolean;
  @ApiProperty({ type: RevocationDto }) data!: RevocationDto;
}
