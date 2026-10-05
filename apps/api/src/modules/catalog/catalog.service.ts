import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Actor } from '../trace/trace.service.js';
import type { ProductDto, FarmDto, PlotDto } from './catalog.dto.js';
import {
  PRODUCT_SELECT,
  FARM_SELECT,
  PLOT_SELECT,
  type CatalogResponse,
} from './catalog-response.js';
@Injectable()
export class CatalogService {
  constructor(private readonly db: PrismaService) {}
  async list(actor: Actor): Promise<CatalogResponse> {
    const where =
      actor.role === 'SYSTEM_ADMIN'
        ? {}
        : {
            organizationId:
              actor.organizationId ?? '00000000-0000-0000-0000-000000000000',
          };
    const [products, farms, plots] = await Promise.all([
      this.db.product.findMany({
        select: PRODUCT_SELECT,
        orderBy: { productName: 'asc' },
      }),
      this.db.farm.findMany({
        where,
        select: FARM_SELECT,
        orderBy: { name: 'asc' },
      }),
      this.db.plot.findMany({
        where: { farm: where },
        select: PLOT_SELECT,
        orderBy: { name: 'asc' },
      }),
    ]);
    return { products, farms, plots };
  }
  createProduct(dto: ProductDto) {
    return this.db.product.create({ data: dto });
  }
  async createFarm(dto: FarmDto) {
    const org = await this.db.organization.findUnique({
      where: { id: dto.organizationId },
    });
    if (!org || org.type !== 'FARM' || org.status !== 'ACTIVE')
      throw new UnprocessableEntityException(
        'Chọn tổ chức nông trại đang hoạt động',
      );
    return this.db.farm.create({ data: dto });
  }
  async createPlot(dto: PlotDto) {
    const farm = await this.db.farm.findUnique({ where: { id: dto.farmId } });
    if (!farm || farm.status !== 'ACTIVE')
      throw new UnprocessableEntityException('Chọn nông trại đang hoạt động');
    return this.db.plot.create({ data: dto });
  }
}
