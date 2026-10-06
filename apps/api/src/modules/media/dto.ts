import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MediaKind, MediaVisibility } from '../../generated/prisma/client.js';

export class UploadMediaDto {
  @IsEnum(MediaKind)
  kind!: MediaKind;

  @IsOptional()
  @IsEnum(MediaVisibility)
  visibility?: MediaVisibility;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  lotId?: string;
}
