import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(255) fullName!: string;
  @IsString() @MinLength(12) password!: string;
  @IsString() roleCode!: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED'])
  accountStatus!: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
}
