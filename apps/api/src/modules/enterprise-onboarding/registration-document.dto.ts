import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID, Matches } from 'class-validator';
import { DOCUMENT_KINDS } from './registration-profile.dto.js';
export class RegistrationDocumentUploadDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() registrationId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() verificationId!: string;
  @ApiProperty({ writeOnly: true, pattern: '^[A-Za-z0-9_-]{43}$' })
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) @IsIn(DOCUMENT_KINDS) kind!: string;
}
export class RegistrationDocumentViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() mediaType!: string;
  @ApiProperty({ minimum: 1, maximum: 5242880 }) size!: number;
  @ApiProperty() sha256!: string;
}
export class RegistrationDocumentContentDto extends RegistrationDocumentViewDto {
  @ApiProperty({
    format: 'byte',
    description:
      'Private file bytes, available only to its registration owner or SYSTEM_ADMIN.',
  })
  contentBase64!: string;
}
export const registrationDocumentSelect = {
  id: true,
  kind: true,
  fileName: true,
  mediaType: true,
  size: true,
  sha256: true,
} as const;
