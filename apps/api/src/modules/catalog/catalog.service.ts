import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { FarmDto, PlotDto, ProductDto } from './catalog.dto.js';

type Actor = { role: string; organizationId: string | null };
const optionalText = (value?: string | null) => value?.trim() || null;

@Injectable()
export class CatalogService {
  constructor(private readonly db: PrismaService) {}

  async list(actor: Actor) {
    const admin = actor.role === 'SYSTEM_ADMIN';
    if (!admin && actor.role !== 'FARM_STAFF') throw new ForbiddenException();
    if (!admin && !actor.organizationId)
      throw new ForbiddenException('Organization required');
    const where: Prisma.FarmWhereInput = admin
      ? {}
      : {
          organizationId: actor.organizationId!,
          status: 'ACTIVE',
          organization: { type: 'FARM', status: 'ACTIVE' },
        };
    const [products, farms, plots] = await Promise.all([
      this.db.product.findMany({
        where: admin ? {} : { status: 'ACTIVE' },
        orderBy: { productName: 'asc' },
      }),
      this.db.farm.findMany({
        where,
        include: { organization: true },
        orderBy: { name: 'asc' },
      }),
      this.db.plot.findMany({
        where: { farm: where, ...(admin ? {} : { status: 'ACTIVE' as const }) },
        include: { farm: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { products, farms, plots };
  }

  // Predicate reads under SERIALIZABLE prevent concurrent API creates from
  // passing the same duplicate check. Unknown failures stay in PROCESSING.
  private async write<T>(
    command: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.db.$transaction(command, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        ['P2002', 'P2034'].includes(String(error.code))
      ) {
        throw new ConflictException(
          'Dữ liệu trùng hoặc đã thay đổi; hãy tải lại và kiểm tra',
        );
      }
      throw error;
    }
  }

  createProduct(dto: ProductDto) {
    const data = {
      productName: dto.productName.trim(),
      variety: optionalText(dto.variety),
      defaultUnit: optionalText(dto.defaultUnit),
    };
    return this.write(async (tx) => {
      if (
        await tx.product.findFirst({
          where: { productName: data.productName, variety: data.variety },
        })
      )
        throw new ConflictException('Sản phẩm và giống đã tồn tại');
      return tx.product.create({ data });
    });
  }

  createFarm(dto: FarmDto) {
    const data = {
      ...dto,
      name: dto.name.trim(),
      location: optionalText(dto.location),
    };
    return this.write(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (!org || org.type !== 'FARM' || org.status !== 'ACTIVE')
        throw new UnprocessableEntityException(
          'Chọn tổ chức nông trại đang hoạt động',
        );
      if (
        await tx.farm.findFirst({
          where: { organizationId: data.organizationId, name: data.name },
        })
      )
        throw new ConflictException('Tên nông trại đã tồn tại trong tổ chức');
      return tx.farm.create({ data });
    });
  }

  createPlot(dto: PlotDto, actor: Actor) {
    return this.write(async (tx) => {
      const farm = await tx.farm.findUnique({
        where: { id: dto.farmId },
        include: { organization: true },
      });
      if (
        !farm ||
        farm.status !== 'ACTIVE' ||
        farm.organization.status !== 'ACTIVE' ||
        farm.organization.type !== 'FARM'
      )
        throw new UnprocessableEntityException(
          'Chọn nông trại thuộc tổ chức FARM đang hoạt động',
        );
      if (
        actor.role !== 'SYSTEM_ADMIN' &&
        (!actor.organizationId || actor.organizationId !== farm.organizationId)
      )
        throw new ForbiddenException(
          'Bạn không có quyền truy cập nông trại này',
        );
      const data = {
        ...dto,
        name: dto.name.trim(),
        unit: optionalText(dto.unit),
        location: optionalText(dto.location),
      };
      if (
        await tx.plot.findFirst({
          where: { farmId: data.farmId, name: data.name },
        })
      )
        throw new ConflictException('Tên thửa đất đã tồn tại trong nông trại');
      return tx.plot.create({ data });
    });
  }
}
