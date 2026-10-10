import { ApiProperty } from '@nestjs/swagger';

class AuthRoleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
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

export class AuthSessionResponseDto {
  @ApiProperty({ enum: [true] }) success!: boolean;
  @ApiProperty({ type: AuthSessionDto }) data!: AuthSessionDto;
}

export class AuthProfileResponseDto {
  @ApiProperty({ enum: [true] }) success!: boolean;
  @ApiProperty({ type: AuthUserDto }) data!: AuthUserDto;
}

class RevocationDto {
  @ApiProperty({ enum: [true] }) revoked!: boolean;
}

export class AuthLogoutResponseDto {
  @ApiProperty({ enum: [true] }) success!: boolean;
  @ApiProperty({ type: RevocationDto }) data!: RevocationDto;
}
