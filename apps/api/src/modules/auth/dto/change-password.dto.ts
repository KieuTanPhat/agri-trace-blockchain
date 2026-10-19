import { ApiProperty } from '@nestjs/swagger';
import { IsByteLength, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ format: 'password', maxLength: 72 })
  @IsString()
  @MaxLength(72)
  @IsByteLength(1, 72)
  currentPassword!: string;

  @ApiProperty({
    format: 'password',
    minLength: 12,
    maxLength: 72,
    description:
      'At least 12 characters and at most 72 UTF-8 bytes; must differ from the current password.',
  })
  @IsString()
  @MinLength(12)
  @IsByteLength(12, 72)
  newPassword!: string;
}
