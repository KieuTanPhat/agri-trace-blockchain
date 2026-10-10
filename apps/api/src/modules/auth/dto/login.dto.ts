import { IsByteLength, IsEmail, IsString, MaxLength } from 'class-validator';
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
}
