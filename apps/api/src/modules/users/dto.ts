import {
  IsEmail,
  IsByteLength,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @IsEmail() email!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;
  @IsString() @MinLength(12) @IsByteLength(12, 72) password!: string;
  @IsString() roleCode!: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED'])
  accountStatus!: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
}
