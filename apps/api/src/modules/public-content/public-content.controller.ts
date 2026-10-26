import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { ApiErrorEnvelopeDto } from '../../common/api/api-error.dto.js';
import {
  PublicAnnouncementsPageDto,
  PublicContentQueryDto,
  PublicNewsDetailDto,
  PublicNewsPageDto,
  PublicNewsImageDto,
} from './dto.js';
import { PublicContentService } from './public-content.service.js';
import { NewsImageService } from './news-image.service.js';
@ApiTags('public-content')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('public')
export class PublicContentController {
  constructor(
    private readonly service: PublicContentService,
    private readonly images: NewsImageService,
  ) {}
  @Get('news')
  @Header('Cache-Control', 'no-store')
  @ApiDataResponse(PublicNewsPageDto)
  news(@Query() query: PublicContentQueryDto) {
    return this.service.news(query);
  }
  @Get('news/:id')
  @Header('Cache-Control', 'no-store')
  @ApiDataResponse(PublicNewsDetailDto)
  article(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.article(id);
  }
  @Get('news/:id/cover')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiDataResponse(PublicNewsImageDto)
  @ApiResponse({
    status: 502,
    description: 'Image source failed validation or is unavailable.',
    schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
  })
  cover(@Param('id', ParseUUIDPipe) id: string) {
    return this.images.cover(id);
  }
  @Get('announcements')
  @Header('Cache-Control', 'no-store')
  @ApiDataResponse(PublicAnnouncementsPageDto)
  announcements(@Query() query: PublicContentQueryDto) {
    return this.service.announcements(query);
  }
}
