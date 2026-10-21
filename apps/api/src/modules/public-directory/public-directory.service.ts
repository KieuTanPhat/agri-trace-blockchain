import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { vietnamCalendarDate } from '../../common/expiry-date.js';
import type {
  PublicProductsQueryDto,
  PublicEnterprisesQueryDto,
  PublicProductDetailQueryDto,
  PublicEnterpriseDetailQueryDto,
} from './dto.js';
import {
  PUBLIC_CERTIFICATE_SELECT,
  PUBLIC_ENTERPRISE_SELECT,
  PUBLIC_PRODUCT_SELECT,
  publicLotWhere,
  relatedEnterpriseWhere,
  relatedLotWhere,
} from './public-directory.policy.js';

export function directoryPage<T extends { id: string }>(
  rows: T[],
  limit: number,
) {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { items, hasMore, nextCursor: hasMore ? items.at(-1)!.id : null };
}
function size(value: number | undefined) {
  const limit = value ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new BadRequestException('limit phải từ 1 đến 50');
  return limit;
}
// Prisma parameterizes these values; escape LIKE metacharacters for literal search.
function search(q: string | undefined) {
  return q?.trim().replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class PublicDirectoryService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async products(query: PublicProductsQueryDto) {
    const limit = size(query.limit);
    const q = search(query.q);
    const rows = await this.db.product.findMany({
      where: {
        AND: [
          { status: 'ACTIVE', lots: { some: publicLotWhere() } },
          ...(q
            ? [
                {
                  OR: [
                    {
                      productName: {
                        contains: q,
                        mode: 'insensitive' as const,
                      },
                    },
                    { variety: { contains: q, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
          ...(query.cursor ? [{ id: { gt: query.cursor } }] : []),
        ],
      },
      select: PUBLIC_PRODUCT_SELECT,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return directoryPage(rows, limit);
  }

  async enterprises(query: PublicEnterprisesQueryDto) {
    const limit = size(query.limit);
    const q = search(query.q);
    const rows = await this.db.organization.findMany({
      where: {
        AND: [
          relatedEnterpriseWhere(publicLotWhere()),
          ...(q
            ? [{ name: { contains: q, mode: 'insensitive' as const } }]
            : []),
          ...(query.type ? [{ type: query.type }] : []),
          ...(query.cursor ? [{ id: { gt: query.cursor } }] : []),
        ],
      },
      select: PUBLIC_ENTERPRISE_SELECT,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return directoryPage(rows, limit);
  }

  async product(id: string, query: PublicProductDetailQueryDto) {
    const limit = size(query.limit);
    const lots = publicLotWhere({ productId: id });
    const product = await this.db.product.findFirst({
      where: { id, status: 'ACTIVE', lots: { some: lots } },
      select: PUBLIC_PRODUCT_SELECT,
    });
    if (!product)
      throw new NotFoundException('Không tìm thấy sản phẩm công khai');
    const [enterprises, links] = await Promise.all([
      this.db.organization.findMany({
        where: {
          AND: [
            relatedEnterpriseWhere(lots),
            ...(query.enterpriseCursor
              ? [{ id: { gt: query.enterpriseCursor } }]
              : []),
          ],
        },
        select: PUBLIC_ENTERPRISE_SELECT,
        orderBy: { id: 'asc' },
        take: limit + 1,
      }),
      this.db.lot.findMany({
        where: {
          AND: [
            lots,
            ...(query.lotCursor ? [{ id: { gt: query.lotCursor } }] : []),
          ],
        },
        select: {
          id: true,
          lotCode: true,
          traceQr: { select: { traceToken: true } },
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
      }),
    ]);
    return {
      ...product,
      enterprises: directoryPage(enterprises, limit),
      lots: directoryPage(
        links.map((lot) => ({
          id: lot.id,
          lotCode: lot.lotCode,
          traceToken: lot.traceQr!.traceToken,
        })),
        limit,
      ),
    };
  }

  async enterprise(id: string, query: PublicEnterpriseDetailQueryDto) {
    const limit = size(query.limit);
    const lots = publicLotWhere(relatedLotWhere(id));
    const enterprise = await this.db.organization.findFirst({
      where: { AND: [{ id }, relatedEnterpriseWhere(lots)] },
      select: PUBLIC_ENTERPRISE_SELECT,
    });
    if (!enterprise)
      throw new NotFoundException('Không tìm thấy doanh nghiệp công khai');
    const today = new Date(`${vietnamCalendarDate(new Date())}T00:00:00.000Z`);
    const certificateWhere: Prisma.CertificateWhereInput = {
      AND: [
        {
          isPublic: true,
          status: 'APPROVED',
          issueDate: { lte: today },
          replacements: { none: { status: 'APPROVED' } },
        },
        { OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] },
        {
          OR: [
            { lot: { is: lots } },
            {
              cycle: { is: { harvestEvents: { some: { lot: { is: lots } } } } },
            },
          ],
        },
        ...(query.certificateCursor
          ? [{ id: { gt: query.certificateCursor } }]
          : []),
      ],
    };
    const [products, certificates] = await Promise.all([
      this.db.product.findMany({
        where: {
          status: 'ACTIVE',
          lots: { some: lots },
          ...(query.productCursor ? { id: { gt: query.productCursor } } : {}),
        },
        select: PUBLIC_PRODUCT_SELECT,
        orderBy: { id: 'asc' },
        take: limit + 1,
      }),
      this.db.certificate.findMany({
        where: certificateWhere,
        select: PUBLIC_CERTIFICATE_SELECT,
        orderBy: { id: 'asc' },
        take: limit + 1,
      }),
    ]);
    return {
      ...enterprise,
      products: directoryPage(products, limit),
      certificates: directoryPage(
        certificates.map((cert) => ({
          ...cert,
          issueDate: cert.issueDate.toISOString().slice(0, 10),
          expiryDate: cert.expiryDate?.toISOString().slice(0, 10) ?? null,
        })),
        limit,
      ),
    };
  }
}
