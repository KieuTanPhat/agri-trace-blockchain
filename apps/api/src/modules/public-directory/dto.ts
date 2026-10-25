import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const PUBLIC_ENTERPRISE_TYPES = [
  'FARM',
  'TRANSPORTER',
  'RETAILER',
  'AUDITOR',
  'DISTRIBUTOR',
  'PROCESSOR',
] as const;

export type PublicEnterpiseType = (typeof PUBLIC_ENTERPRISE_TYPES)[number];
export type PublicEnterpriseType = PublicEnterpiseType;

export class PublicDirectoryQueryDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: 'Từ khóa tìm kiếm, bỏ khoảng trắng đầu/cuối.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Giá trị nextCursor từ trang trước. Bỏ trống ở trang đầu.',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({
    type: Number,
    default: 20,
    minimum: 1,
    maximum: 50,
    description: 'Số mục mỗi trang.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class PublicProductsQueryDto extends PublicDirectoryQueryDto {}

export class PublicEnterprisesQueryDto extends PublicDirectoryQueryDto {
  @ApiPropertyOptional({
    enum: PUBLIC_ENTERPRISE_TYPES,
    description: 'Loại tổ chức. Không phải role người dùng.',
  })
  @IsOptional()
  @IsIn(PUBLIC_ENTERPRISE_TYPES)
  type?: PublicEnterpiseType;
}

export class PublicDirectoryProductDto {
  @ApiProperty({ type: String, maxLength: 255 })
  productName!: string;
  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 255,
  })
  variety!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 30,
  })
  defaultUnit!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
  })
  description!: string | null;
}

export class PublicDirectoryEnterpriseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    type: String,
    maxLength: 255,
  })
  name!: string;

  @ApiProperty({
    enum: PUBLIC_ENTERPRISE_TYPES,
  })
  type!: PublicEnterpiseType;
}

export class PublicProductsPageDto {
  @ApiProperty({
    type: () => PublicDirectoryProductDto,
    isArray: true,
  })
  items!: PublicDirectoryProductDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null khi không còn trang tiếp theo.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'Có thể tải tiếp hay không.',
  })
  hasMore!: boolean;
}

export class PublicEnterprisesPageDto {
  @ApiProperty({
    type: () => PublicDirectoryEnterpriseDto,
    isArray: true,
  })
  items!: PublicDirectoryEnterpriseDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null khi không còn trang tiếp theo.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: Boolean,
  })
  hasMore!: boolean;
}

export class PublicPageSizeDto {
  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
export class PublicProductDetailQueryDto extends PublicPageSizeDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  enterpriseCursor?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lotCursor?: string;
}
export class PublicEnterpriseDetailQueryDto extends PublicPageSizeDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productCursor?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  certificateCursor?: string;
}
export class PublicTraceLinkDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) lotCode!: string;
  @ApiProperty({ type: String }) traceToken!: string;
}
export class PublicDirectoryCertificateDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) type!: string;
  @ApiProperty({ type: String }) issuer!: string;
  @ApiProperty({ type: String, format: 'date' }) issueDate!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) expiryDate!:
    string | null;
  @ApiProperty({ type: String }) documentHash!: string;
}
export class PublicTraceLinksPageDto {
  @ApiProperty({ type: () => PublicTraceLinkDto, isArray: true })
  items!: PublicTraceLinkDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!:
    string | null;
  @ApiProperty({ type: Boolean }) hasMore!: boolean;
}
export class PublicCertificatesPageDto {
  @ApiProperty({ type: () => PublicDirectoryCertificateDto, isArray: true })
  items!: PublicDirectoryCertificateDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) nextCursor!:
    string | null;
  @ApiProperty({ type: Boolean }) hasMore!: boolean;
}
export class PublicProductDetailDto extends PublicDirectoryProductDto {
  @ApiProperty({ type: () => PublicEnterprisesPageDto })
  enterprises!: PublicEnterprisesPageDto;
  @ApiProperty({ type: () => PublicTraceLinksPageDto })
  lots!: PublicTraceLinksPageDto;
}
export class PublicEnterpriseDetailDto extends PublicDirectoryEnterpriseDto {
  @ApiProperty({ type: () => PublicProductsPageDto })
  products!: PublicProductsPageDto;
  @ApiProperty({ type: () => PublicCertificatesPageDto })
  certificates!: PublicCertificatesPageDto;
}
