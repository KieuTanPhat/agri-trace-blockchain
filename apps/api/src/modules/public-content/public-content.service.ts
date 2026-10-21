import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { PublicContentQueryDto } from './dto.js';
import {
  allowedCover,
  contentCursor,
  contentLimit,
  literalSearch,
  parseContentCursor,
} from './content-policy.js';
const newsSelect = {
  id: true,
  title: true,
  summary: true,
  coverUrl: true,
  publishedAt: true,
} as const;
@Injectable()
export class PublicContentService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  async news(query: PublicContentQueryDto) {
    const limit = contentLimit(query.limit),
      cursor = parseContentCursor('news', query.cursor),
      q = literalSearch(query.q);
    const rows = await this.db.consumerNews.findMany({
      where: {
        AND: [
          { isPublished: true, publishedAt: { lte: new Date() } },
          ...(q
            ? [
                {
                  OR: [
                    { title: { contains: q, mode: 'insensitive' as const } },
                    { summary: { contains: q, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
          ...(cursor
            ? [
                {
                  OR: [
                    { publishedAt: { lt: cursor.time } },
                    { publishedAt: cursor.time, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: newsSelect,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map((row) => this.projectNews(row));
    return {
      items,
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit
          ? contentCursor(
              'news',
              items.at(-1)!.id,
              new Date(items.at(-1)!.publishedAt),
            )
          : null,
    };
  }
  async article(id: string) {
    const row = await this.db.consumerNews.findFirst({
      where: { id, isPublished: true, publishedAt: { lte: new Date() } },
      select: { ...newsSelect, body: true },
    });
    if (!row)
      throw new NotFoundException(
        'Bài viết không tồn tại hoặc chưa công khai.',
      );
    return { ...this.projectNews(row), body: row.body };
  }
  private projectNews(row: {
    id: string;
    title: string;
    summary: string;
    publishedAt: Date | null;
    coverUrl: string | null;
  }) {
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      publishedAt: row.publishedAt!.toISOString(),
      coverUrl: allowedCover(
        row.coverUrl,
        this.config.get<string>('PUBLIC_NEWS_IMAGE_HOSTS'),
      ),
    };
  }
  async announcements(query: PublicContentQueryDto) {
    const limit = contentLimit(query.limit),
      cursor = parseContentCursor('announcements', query.cursor),
      q = literalSearch(query.q),
      now = new Date();
    const rows = await this.db.consumerAnnouncement.findMany({
      where: {
        AND: [
          { isActive: true, startsAt: { lte: now } },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          ...(q
            ? [{ title: { contains: q, mode: 'insensitive' as const } }]
            : []),
          ...(cursor
            ? [
                {
                  OR: [
                    { startsAt: { lt: cursor.time } },
                    { startsAt: cursor.time, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        title: true,
        body: true,
        severity: true,
        startsAt: true,
        endsAt: true,
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const items = rows
      .slice(0, limit)
      .map((row) => ({
        ...row,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt?.toISOString() ?? null,
      }));
    return {
      items,
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit
          ? contentCursor(
              'announcements',
              items.at(-1)!.id,
              new Date(items.at(-1)!.startsAt),
            )
          : null,
    };
  }
}
