import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { allowedCover } from './content-policy.js';
import {
  NEWS_IMAGE_FETCH,
  imageDimensions,
  type NewsImageFetcher,
} from './news-image.js';
import type { PublicNewsImageDto } from './dto.js';

@Injectable()
export class NewsImageService {
  private cache = new Map<
    string,
    { expires: number; image: PublicNewsImageDto }
  >();
  private pending = new Map<string, Promise<PublicNewsImageDto>>();
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(NEWS_IMAGE_FETCH) private readonly download: NewsImageFetcher,
  ) {}
  async cover(id: string) {
    // Recheck publication/allowlist even on cache hits; no cached private articles.
    const row = await this.db.consumerNews.findFirst({
      where: { id, isPublished: true, publishedAt: { lte: new Date() } },
      select: { coverUrl: true },
    });
    const url =
      row &&
      allowedCover(
        row.coverUrl,
        this.config.get<string>('PUBLIC_NEWS_IMAGE_HOSTS'),
      );
    if (!url) throw new NotFoundException('Chưa có ảnh bìa công khai.');
    const cached = this.cache.get(url);
    if (cached && cached.expires > Date.now()) return { ...cached.image };
    const pending = this.pending.get(url);
    if (pending) return { ...(await pending) };
    if (this.pending.size >= 3)
      throw new ServiceUnavailableException(
        'Ảnh đang bận tải. Vui lòng thử lại sau.',
      );
    const task = this.load(url).finally(() => this.pending.delete(url));
    this.pending.set(url, task);
    return { ...(await task) };
  }
  private async load(url: string): Promise<PublicNewsImageDto> {
    try {
      const image = await this.download(new URL(url));
      const dimensions = imageDimensions(image);
      const projected: PublicNewsImageDto = {
        mimeType: image.contentType as PublicNewsImageDto['mimeType'],
        dataBase64: image.bytes.toString('base64'),
        ...dimensions,
      };
      if (this.cache.size >= 8)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(url, { expires: Date.now() + 60_000, image: projected });
      return projected;
    } catch {
      throw new BadGatewayException(
        'Chưa tải được ảnh bìa. Nội dung bài viết vẫn xem được.',
      );
    }
  }
}
