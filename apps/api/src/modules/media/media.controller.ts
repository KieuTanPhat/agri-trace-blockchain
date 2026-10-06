import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MediaKind, MediaVisibility } from '../../generated/prisma/client.js';
import { UploadMediaDto } from './dto.js';
import { MAX_MEDIA_BYTES, type UploadedMediaFile } from './media.constants.js';
import { MediaService } from './media.service.js';

@ApiTags('media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'kind'],
      properties: {
        file: { type: 'string', format: 'binary' },
        kind: { type: 'string', enum: Object.values(MediaKind) },
        visibility: { type: 'string', enum: Object.values(MediaVisibility) },
        productId: { type: 'string', format: 'uuid' },
        lotId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_MEDIA_BYTES, files: 1 } }))
  upload(
    @Body() input: UploadMediaDto,
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.upload(input, file, request.user);
  }

  @Get()
  list(
    @Query('productId', new ParseUUIDPipe({ optional: true })) productId: string | undefined,
    @Query('lotId', new ParseUUIDPipe({ optional: true })) lotId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.list(productId, lotId, request.user);
  }

  @Get(':id')
  getMetadata(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.getMetadata(id, request.user);
  }

  @Get(':id/content')
  async getContent(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const { asset, buffer } = await this.media.getContent(id, request.user);
    sendContent(response, asset.mimeType, asset.sha256, buffer, false);
  }
}

@ApiTags('public-media')
@Controller('public/media')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(
    @Query('productId', new ParseUUIDPipe({ optional: true })) productId?: string,
    @Query('lotId', new ParseUUIDPipe({ optional: true })) lotId?: string,
  ) {
    return this.media.list(productId, lotId, null);
  }

  @Get(':id')
  getMetadata(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.getMetadata(id, null);
  }

  @Get(':id/content')
  async getContent(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const { asset, buffer } = await this.media.getContent(id, null);
    sendContent(response, asset.mimeType, asset.sha256, buffer, true);
  }
}

function sendContent(
  response: Response,
  mimeType: string,
  sha256: string,
  buffer: Buffer,
  publicAsset: boolean,
) {
  response.setHeader('Content-Type', mimeType);
  response.setHeader('Content-Length', buffer.length);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Content-SHA256', sha256);
  response.setHeader('Cache-Control', publicAsset ? 'public, max-age=3600' : 'private, no-store');
  response.setHeader(
    'Content-Disposition',
    mimeType === 'application/pdf' ? 'attachment; filename="document.pdf"' : 'inline',
  );
  response.status(200).send(buffer);
}
