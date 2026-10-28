import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from '../platform-governance/platform-audit.js';
import {
  AdminNewsDto,
  AdminNewsPageDto,
  NewsWriteInput,
  NewsUpdateInput,
  NewsStatusInput,
} from './admin-news.dto.js';
import { imageDimensions } from './news-image.js';
import { PublicNewsImageDto } from './dto.js';
const select = {
  id: true,
  title: true,
  summary: true,
  body: true,
  version: true,
  isPublished: true,
  publishedAt: true,
  updatedAt: true,
  coverMimeType: true,
  coverUrl: true,
} as const;
function project(row: {
  id: string;
  title: string;
  summary: string;
  body: string;
  version: number;
  isPublished: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
  coverMimeType: string | null;
  coverUrl: string | null;
}) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    version: row.version,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    hasCover: !!(row.coverMimeType || row.coverUrl),
  };
}
export function newsCover(input: NewsWriteInput) {
  if (input.removeCover && (input.coverBase64 || input.coverMimeType))
    throw new BadRequestException('Chọn ảnh mới hoặc xóa ảnh hiện tại.');
  if (input.removeCover)
    return { coverContent: null, coverMimeType: null, coverUrl: null };
  if (!input.coverBase64 && !input.coverMimeType) return {};
  if (
    !input.coverBase64 ||
    !input.coverMimeType ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      input.coverBase64,
    )
  )
    throw new BadRequestException('Ảnh không hợp lệ.');
  const bytes = Buffer.from(input.coverBase64, 'base64');
  try {
    imageDimensions({ bytes, contentType: input.coverMimeType });
  } catch {
    throw new BadRequestException(
      'Ảnh JPG, PNG hoặc WebP tối đa 384 KB, mỗi chiều tối đa 2048 px.',
    );
  }
  return {
    coverContent: new Uint8Array(bytes),
    coverMimeType: input.coverMimeType,
    coverUrl: null,
  };
}
@ApiTags('admin-news')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN')
@Controller('platform-admin/news')
export class AdminNewsController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}
  @Get()
  @Header('Cache-Control','no-store')
  @ApiDataResponse(AdminNewsPageDto)
  async list() {
    return {
      items: (
        await this.db.consumerNews.findMany({
          where: { archivedAt: null },
          select,
          orderBy: { updatedAt: 'desc' },
          take: 200,
        })
      ).map(project),
    };
  }
  @Get(':id/cover')
  @Header('Cache-Control','no-store')
  @ApiDataResponse(PublicNewsImageDto)
  async cover(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.db.consumerNews.findFirst({
      where: { id, archivedAt: null },
      select: { coverContent: true, coverMimeType: true },
    });
    if (!row?.coverContent || !row.coverMimeType)
      throw new NotFoundException('Chưa có ảnh bìa.');
    const bytes = Buffer.from(row.coverContent);
    return {
      mimeType: row.coverMimeType,
      dataBase64: bytes.toString('base64'),
      ...imageDimensions({ bytes, contentType: row.coverMimeType }),
    };
  }
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(AdminNewsDto, 201)
  create(
    @Body() input: NewsWriteInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.write(req, key, 'PLATFORM_NEWS_CREATE', input, async (tx) => {
      const cover = newsCover(input);
      const row = await tx.consumerNews.create({
        data: {
          title: input.title.trim(),
          summary: input.summary.trim(),
          body: input.body.trim(),
          ...cover,
        },
      });
      await appendPlatformAudit(tx, {
        actor: req.user,
        action: 'PLATFORM_NEWS_CREATE',
        subjectType: 'CONSUMER_NEWS',
        subjectId: row.id,
        details: { title: row.title },
      });
      return project(row);
    });
  }
  @Post(':id')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(AdminNewsDto, 201)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: NewsUpdateInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.write(
      req,
      key,
      'PLATFORM_NEWS_UPDATE',
      { id, ...input },
      async (tx) => {
        const cover = newsCover(input);
        const changed = await tx.consumerNews.updateMany({
          where: { id, version: input.version, archivedAt: null },
          data: {
            title: input.title.trim(),
            summary: input.summary.trim(),
            body: input.body.trim(),
            ...cover,
            version: { increment: 1 },
          },
        });
        if (!changed.count)
          throw new ConflictException(
            'Bản tin đã thay đổi. Tải lại trước khi sửa.',
          );
        const row = await tx.consumerNews.findUniqueOrThrow({ where: { id } });
        await appendPlatformAudit(tx, {
          actor: req.user,
          action: 'PLATFORM_NEWS_UPDATE',
          subjectType: 'CONSUMER_NEWS',
          subjectId: id,
          details: { version: row.version },
        });
        return project(row);
      },
    );
  }
  @Post(':id/status')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(AdminNewsDto, 201)
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: NewsStatusInput,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.write(
      req,
      key,
      'PLATFORM_NEWS_STATUS',
      { id, ...input },
      async (tx) => {
        const row = await tx.consumerNews.findFirst({
          where: { id, archivedAt: null },
          select,
        });
        if (!row) throw new NotFoundException('Không tìm thấy bản tin.');
        const changed = await tx.consumerNews.updateMany({
          where: { id, version: input.version, archivedAt: null },
          data: {
            isPublished: input.action === 'PUBLISH',
            ...(input.action === 'PUBLISH'
              ? { publishedAt: new Date() }
              : {}),
            ...(input.action === 'ARCHIVE' ? { archivedAt: new Date() } : {}),
            version: { increment: 1 },
          },
        });
        if (!changed.count)
          throw new ConflictException(
            'Bản tin đã thay đổi. Tải lại trước khi thao tác.',
          );
        await appendPlatformAudit(tx, {
          actor: req.user,
          action: 'PLATFORM_NEWS_STATUS',
          subjectType: 'CONSUMER_NEWS',
          subjectId: id,
          details: { action: input.action },
        });
        return project(
          await tx.consumerNews.findUniqueOrThrow({ where: { id } }),
        );
      },
    );
  }
  private write<T>(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: Parameters<typeof commandTransaction<T>>[1],
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation,
        requestType: 'COMMAND',
        payload,
      },
      () =>
        commandTransaction(this.db, async (tx) => {
          await lockPlatformAudit(tx);
          return work(tx);
        }),
    );
  }
}
