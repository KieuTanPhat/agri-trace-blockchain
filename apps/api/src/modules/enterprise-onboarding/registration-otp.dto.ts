import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsUUID, Matches, MaxLength } from 'class-validator';
export class RegistrationOtpRequest {
  @ApiProperty({
    format: 'uuid',
    description: 'The same stable id used for the final registration',
  })
  @IsUUID()
  registrationId!: string;
  @ApiProperty({
    format: 'uuid',
    description: 'Stable send attempt id; retain on network failure',
  })
  @IsUUID()
  requestId!: string;
  @ApiProperty({ format: 'email', maxLength: 255 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
export class RegistrationOtpVerify {
  @ApiProperty({ format: 'uuid' }) @IsUUID() registrationId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() verificationId!: string;
  @ApiProperty({
    format: 'uuid',
    description:
      'Stable verification attempt id; exact retry does not burn another attempt',
  })
  @IsUUID()
  attemptId!: string;
  @ApiProperty({ pattern: '^[0-9]{6}$', writeOnly: true })
  @Matches(/^\d{6}$/)
  code!: string;
}
export class RegistrationOtpReceipt {
  @ApiProperty({ format: 'uuid' }) verificationId!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time' }) resendAfter!: string;
  @ApiProperty({
    description: 'Issuance never discloses the OTP. Delivery is asynchronous.',
  })
  queued!: boolean;
}
export class RegistrationEmailProof {
  @ApiProperty({ format: 'uuid' }) @IsUUID() verificationId!: string;
  @ApiProperty({ pattern: '^[A-Za-z0-9_-]{43}$', writeOnly: true })
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}
export class RegistrationOtpVerifiedView {
  @ApiProperty({ format: 'uuid' }) verificationId!: string;
  @ApiProperty({
    description:
      'One-time registration proof; never log/cache/store in browser persistence',
  })
  token!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
