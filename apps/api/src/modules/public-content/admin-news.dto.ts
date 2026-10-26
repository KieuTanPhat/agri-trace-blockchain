import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class NewsWriteInput {
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title!: string;
  @ApiProperty({ maxLength: 1000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  summary!: string;
  @ApiProperty({ maxLength: 50000, description: 'Plain text.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(50000)
  body!: string;
  @ApiPropertyOptional({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  @IsOptional()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  coverMimeType?: string;
  @ApiPropertyOptional({ maxLength: 524288 })
  @IsOptional()
  @IsString()
  @MaxLength(524288)
  coverBase64?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() removeCover?: boolean;
}
export class NewsUpdateInput extends NewsWriteInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class NewsStatusInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['PUBLISH', 'WITHDRAW', 'ARCHIVE'] })
  @IsIn(['PUBLISH', 'WITHDRAW', 'ARCHIVE'])
  action!: 'PUBLISH' | 'WITHDRAW' | 'ARCHIVE';
}
export class AdminNewsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
  @ApiProperty() body!: string;
  @ApiProperty() version!: number;
  @ApiProperty() isPublished!: boolean;
  @ApiProperty() hasCover!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  publishedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class AdminNewsPageDto {
  @ApiProperty({ type: () => AdminNewsDto, isArray: true })
  items!: AdminNewsDto[];
}
