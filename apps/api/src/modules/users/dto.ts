import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullName!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  roleCode!: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateUserAssignmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  roleCode!: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED'])
  accountStatus!: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
}