import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString() @MaxLength(255) name!: string;
  @IsIn(['FARM', 'TRANSPORTER', 'RETAILER', 'AUDITOR'])
  type!: 'FARM' | 'TRANSPORTER' | 'RETAILER' | 'AUDITOR';
}

export class UpdateOrganizationDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
