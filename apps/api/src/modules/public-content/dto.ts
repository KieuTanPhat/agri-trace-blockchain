import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicContentQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  q?: string;
  @ApiPropertyOptional({
    maxLength: 256,
    description: 'Opaque nextCursor from the preceding response.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
export class PublicNewsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 255 }) title!: string;
  @ApiProperty({ maxLength: 1000 }) summary!: string;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'HTTPS URL on an explicitly allowed host, otherwise null.',
  })
  coverUrl!: string | null;
}
export class PublicNewsDetailDto extends PublicNewsDto {
  @ApiProperty({
    maxLength: 50000,
    description: 'Plain text, never HTML/Markdown.',
  })
  body!: string;
}
export class PublicNewsImageDto {
  @ApiProperty({ enum: ['image/png', 'image/jpeg', 'image/webp'] })
  mimeType!: 'image/png' | 'image/jpeg' | 'image/webp';
  @ApiProperty({
    maxLength: 524288,
    description: 'Bounded base64 raster image. Never an external URL or HTML.',
  })
  dataBase64!: string;
  @ApiProperty({ minimum: 1, maximum: 2048 }) width!: number;
  @ApiProperty({ minimum: 1, maximum: 2048 }) height!: number;
}
export class PublicAnnouncementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 255 }) title!: string;
  @ApiProperty({ maxLength: 5000, description: 'Plain text.' }) body!: string;
  @ApiProperty({ enum: ['INFO', 'WARNING', 'CRITICAL'] }) severity!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endsAt!:
    string | null;
}
export class PublicNewsPageDto {
  @ApiProperty({ type: () => PublicNewsDto, isArray: true })
  items!: PublicNewsDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
export class PublicAnnouncementsPageDto {
  @ApiProperty({ type: () => PublicAnnouncementDto, isArray: true })
  items!: PublicAnnouncementDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
