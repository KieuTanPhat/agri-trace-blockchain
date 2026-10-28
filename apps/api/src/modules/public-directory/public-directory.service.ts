import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { vietnamCalendarDate } from '../../common/expiry-date.js';
import {sellingLots} from './public-sale-status.js';
import {publicContact,publicProductDetails,visibleDirectoryImage} from './public-directory.presentation.js';
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
  private async distributedOrgs(lots:Prisma.LotWhereInput){
    const rows=await this.db.lot.findMany({where:lots,select:{id:true}});
    if(!rows.length)return [];
    const lines=await this.db.distributionLine.findMany({where:{lotId:{in:rows.map(r=>r.id)},transfer:{status:{not:'CANCELLED'}}},select:{transfer:{select:{senderId:true,carrierId:true,receiverId:true}}}});
    return [...new Set(lines.flatMap(l=>[l.transfer.senderId,l.transfer.carrierId,l.transfer.receiverId]))];
  }

  private async presentProducts(rows:Prisma.ProductGetPayload<{select:typeof PUBLIC_PRODUCT_SELECT}>[]) {
    const selling=await sellingLots(this.db,rows.map(r=>r.id));
    const marketLots=await this.db.lot.findMany({where:{id:{in:[...selling]}},select:{productId:true}});
    const sellingProducts=new Set(marketLots.map(l=>l.productId));
    const lotIds=rows.flatMap(r=>(r.lots??[]).map(l=>l.id));
    const images=lotIds.length?await this.db.traceEvidence.findMany({where:{entityType:'LOT',entityId:{in:lotIds}},select:{id:true,entityId:true,public:true,kind:true,supersedesId:true,mediaType:true,withdrawal:{select:{evidenceId:true}}},orderBy:{createdAt:'desc'}}):[];
    return rows.map(row=>{const image=visibleDirectoryImage(images.filter(i=>(row.lots??[]).some(l=>l.id===i.entityId)));return {id:row.id,saleStatus:sellingProducts.has(row.id)?'SELLING':'NOT_SELLING',productName:row.productName,variety:row.variety??null,defaultUnit:row.defaultUnit??null,description:row.description??null,
      ...publicProductDetails(row,row.organization?.directoryPublications?.[0]?.presentation),createdAt:row.createdAt?.toISOString()??new Date(0).toISOString(),traceCount:row._count?.lots??0,
      imageUrl:image?`/public/products/${row.id}/image?v=${image.id}`:null};});
  }
  private presentEnterprise(row:Prisma.OrganizationGetPayload<{select:typeof PUBLIC_ENTERPRISE_SELECT}>) {
    const {published: _published,logoEvidenceId,...contact}=publicContact(row.directoryPublications?.[0]?.presentation);
    return {id:row.id,name:row.name,type:row.type,...contact,logoUrl:logoEvidenceId?`/public/enterprises/${row.id}/logo?v=${logoEvidenceId}`:null};
  }
  async productImage(id:string) {
    const row=await this.db.product.findFirst({where:{id,status:'ACTIVE',lots:{some:publicLotWhere()}},select:PUBLIC_PRODUCT_SELECT});
    if(!row)throw new NotFoundException('Không có ảnh sản phẩm công khai');
    const rows=await this.db.traceEvidence.findMany({where:{entityType:'LOT',entityId:{in:row.lots.map(l=>l.id)}},select:{id:true,public:true,kind:true,supersedesId:true,mediaType:true,withdrawal:{select:{evidenceId:true}}},orderBy:{createdAt:'desc'}});
    const visible=visibleDirectoryImage(rows);if(!visible)throw new NotFoundException('Không có ảnh sản phẩm công khai');
    return this.db.traceEvidence.findUniqueOrThrow({where:{id:visible.id},select:{content:true,mediaType:true,sha256:true}});
  }
  async enterpriseLogo(id:string) {
    const related=await this.distributedOrgs(publicLotWhere());
    const row=await this.db.organization.findFirst({where:{AND:[{id},relatedEnterpriseWhere(publicLotWhere(),related)]},select:PUBLIC_ENTERPRISE_SELECT});
    if(!row)throw new NotFoundException();
    const {logoEvidenceId}=publicContact(row.directoryPublications?.[0]?.presentation);
    if(!logoEvidenceId)throw new NotFoundException();
    const logo=await this.db.traceEvidence.findFirst({where:{id:logoEvidenceId,organizationId:id,entityType:'PROFILE',entityId:id,kind:'OTHER',mediaType:{in:['image/jpeg','image/png']},withdrawal:null},select:{content:true,mediaType:true,sha256:true,id:true}});
    if(!logo||await this.db.traceEvidence.findFirst({where:{supersedesId:logo.id},select:{id:true}}))throw new NotFoundException();
    return logo;
  }

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
    return directoryPage(await this.presentProducts(rows.slice(0,limit+1)), limit);
  }

  async enterprises(query: PublicEnterprisesQueryDto) {
    const limit = size(query.limit);
    const q = search(query.q);
    const related=await this.distributedOrgs(publicLotWhere());
    const rows = await this.db.organization.findMany({
      where: {
        AND: [
          relatedEnterpriseWhere(publicLotWhere(),related),
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
    return directoryPage(rows.map(row=>this.presentEnterprise(row)), limit);
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
    const related=await this.distributedOrgs(lots);
    const [enterprises, links] = await Promise.all([
      this.db.organization.findMany({
        where: {
          AND: [
            relatedEnterpriseWhere(lots,related),
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
          lotName:true,expiryDate:true,currentState:true,createdAt:true,
          traceQr: { select: { traceToken: true } },
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
      }),
    ]);
    const scanLots=await this.db.lot.findMany({where:lots,select:{id:true}});
    const scans=await this.db.traceScanDaily.aggregate({where:{lotId:{in:scanLots.map(l=>l.id)}},_sum:{scans:true}});
    return {
      ...(await this.presentProducts([product]))[0],scanCount:scans._sum.scans??0,
      enterprises: directoryPage(enterprises.map(row=>this.presentEnterprise(row)), limit),
      lots: directoryPage(
        links.map((lot) => ({
          id: lot.id,
          lotCode: lot.lotCode,
          lotName:lot.lotName,expiryDate:lot.expiryDate?.toISOString().slice(0,10)??null,state:lot.currentState,createdAt:lot.createdAt.toISOString(),
          traceToken: lot.traceQr!.traceToken,
        })),
        limit,
      ),
    };
  }

  async enterprise(id: string, query: PublicEnterpriseDetailQueryDto) {
    const limit = size(query.limit);
    const lines=await this.db.distributionLine.findMany({where:{transfer:{status:{not:'CANCELLED'},OR:[{senderId:id},{carrierId:id},{receiverId:id}]}},select:{lotId:true}});
    const lots = publicLotWhere(relatedLotWhere(id,lines.map(l=>l.lotId)));
    const related=await this.distributedOrgs(lots);
    const enterprise = await this.db.organization.findFirst({
      where: { AND: [{ id }, relatedEnterpriseWhere(lots,related)] },
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
      ...this.presentEnterprise(enterprise),
      products: directoryPage(await this.presentProducts(products), limit),
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
