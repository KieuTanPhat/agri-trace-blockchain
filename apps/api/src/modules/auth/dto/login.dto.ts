import { IsEmail, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @IsEmail()
  @ApiProperty({ format: 'email', maxLength: 255 })
  @MaxLength(255)
  email!: string;

  @IsString()
  @ApiProperty({ format: 'password', maxLength: 72 })
  @MaxLength(72)
  password!: string;
}
