import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { MediaKind, MediaVisibility } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import type { UploadMediaDto } from './dto.js';
import { MAX_MEDIA_BYTES, type UploadedMediaFile } from './media.constants.js';

@Injectable()
export class MediaService {
  private readonly storageRoot = resolve(
    process.env.MEDIA_STORAGE_DIR ?? join(process.cwd(), 'uploads'),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async upload(input: UploadMediaDto, file: UploadedMediaFile | undefined, actor: Actor) {
    if (!file?.buffer || file.size < 1 || file.size > MAX_MEDIA_BYTES) {
      throw new BadRequestException('File trống hoặc vượt quá 8 MB');
    }
    if (!actor.sub) throw new ForbiddenException('Cần tài khoản người tải lên');

    const format = this.detectFormat(file.buffer);
    if (!format || file.mimetype !== format.mimeType) {
      throw new BadRequestException('Định dạng file không hợp lệ');
    }
    if (input.kind !== MediaKind.EVIDENCE_DOCUMENT && !format.mimeType.startsWith('image/')) {
      throw new BadRequestException('Ảnh sản phẩm và lô hàng phải là file ảnh');
    }
    if (Boolean(input.productId) === Boolean(input.lotId)) {
      throw new BadRequestException('Chỉ chọn một productId hoặc lotId');
    }
    if (input.kind === MediaKind.PRODUCT_IMAGE ? !input.productId : !input.lotId) {
      throw new BadRequestException('Loại tài liệu không khớp đối tượng được chọn');
    }

    await this.assertUploadAccess(input, actor);
    const visibility = input.visibility ?? MediaVisibility.PRIVATE;
    const storageKey = `${randomUUID()}.${format.extension}`;
    const storagePath = join(this.storageRoot, storageKey);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const originalName = basename(file.originalname.replaceAll('\\', '/'))
      .replace(/\p{Cc}/gu, '')
      .slice(0, 255) || 'upload';

    await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    await writeFile(storagePath, file.buffer, { flag: 'wx', mode: 0o600 });
    try {
      const asset = await this.prisma.mediaAsset.create({
        data: {
          productId: input.productId,
          lotId: input.lotId,
          uploadedById: actor.sub,
          kind: input.kind,
          visibility,
          originalName,
          mimeType: format.mimeType,
          sizeBytes: file.size,
          sha256,
          storageKey,
        },
      });
      return this.metadata(asset, false);
    } catch (error) {
      await unlink(storagePath).catch(() => undefined);
      throw error;
    }
  }

  async list(productId: string | undefined, lotId: string | undefined, actor: Actor | null) {
    if (Boolean(productId) === Boolean(lotId)) {
      throw new BadRequestException('Cần đúng một productId hoặc lotId');
    }
    if (lotId && actor) await this.access.assertLotAccess(actor, lotId);
    if (productId) await this.assertProductExists(productId);

    const publicOnly = !actor || (Boolean(productId) && actor.role !== 'SYSTEM_ADMIN');
    const assets = await this.prisma.mediaAsset.findMany({
      where: { productId, lotId, visibility: publicOnly ? MediaVisibility.PUBLIC : undefined },
      orderBy: { createdAt: 'desc' },
    });
    return assets.map((asset) => this.metadata(asset, !actor));
  }

  async getMetadata(id: string, actor: Actor | null) {
    const asset = await this.findAccessible(id, actor);
    return this.metadata(asset, !actor);
  }

  async getContent(id: string, actor: Actor | null) {
    const asset = await this.findAccessible(id, actor);
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(asset.storageKey)) {
      throw new ConflictException('Đường dẫn lưu trữ không hợp lệ');
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(join(this.storageRoot, asset.storageKey));
    } catch {
      throw new NotFoundException('Không tìm thấy nội dung file');
    }
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (hash !== asset.sha256 || buffer.length !== asset.sizeBytes) {
      throw new ConflictException('Nội dung file không còn toàn vẹn');
    }
    return { asset, buffer };
  }

  private async findAccessible(id: string, actor: Actor | null) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Không tìm thấy ảnh hoặc tài liệu');
    if (!actor) {
      if (asset.visibility !== MediaVisibility.PUBLIC) {
        throw new NotFoundException('Không tìm thấy ảnh hoặc tài liệu');
      }
      return asset;
    }
    if (asset.lotId) {
      await this.access.assertLotAccess(actor, asset.lotId);
    } else if (asset.visibility !== MediaVisibility.PUBLIC && actor.role !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException('Không có quyền xem tài liệu sản phẩm này');
    }
    return asset;
  }

  private async assertUploadAccess(input: UploadMediaDto, actor: Actor) {
    if (input.productId) {
      if (actor.role !== 'SYSTEM_ADMIN') {
        throw new ForbiddenException('Chỉ quản trị viên được đăng ảnh sản phẩm');
      }
      await this.assertProductExists(input.productId);
      return;
    }

    const lot = await this.access.assertLotAccess(actor, input.lotId!);
    const isOwner = actor.role === 'SYSTEM_ADMIN' ||
      (actor.role === 'FARM_STAFF' && actor.organizationId === lot.farmOrgId);
    if (input.kind === MediaKind.LOT_IMAGE && !isOwner) {
      throw new ForbiddenException('Chỉ đơn vị sở hữu lô được đăng ảnh lô');
    }
    if (input.visibility === MediaVisibility.PUBLIC && !isOwner) {
      throw new ForbiddenException('Chỉ đơn vị sở hữu lô được công khai tài liệu');
    }
  }

  private async assertProductExists(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
  }

  private detectFormat(buffer: Buffer) {
    if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return { mimeType: 'image/jpeg', extension: 'jpg' };
    }
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      return { mimeType: 'image/png', extension: 'png' };
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return { mimeType: 'image/webp', extension: 'webp' };
    }
    if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
      return { mimeType: 'application/pdf', extension: 'pdf' };
    }
    return null;
  }

  private metadata(asset: {
    id: string;
    productId: string | null;
    lotId: string | null;
    kind: MediaKind;
    visibility: MediaVisibility;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: Date;
  }, publicView: boolean) {
    return {
      id: asset.id,
      productId: asset.productId,
      lotId: asset.lotId,
      kind: asset.kind,
      visibility: asset.visibility,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      createdAt: asset.createdAt,
      contentUrl: publicView
        ? `/api/public/media/${asset.id}/content`
        : `/api/media/${asset.id}/content`,
    };
  }
}
