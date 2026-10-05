import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateFarmDto,
  CreatePlotDto,
  CreateProductDto,
  UpdateFarmDto,
  UpdatePlotDto,
  UpdateProductDto,
} from './dto.js';

export type CatalogActor = {
  role: string;
  organizationId: string | null;
};

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listProducts(actor: CatalogActor) {
    return this.prisma.product.findMany({
      where: actor.role === 'SYSTEM_ADMIN' ? {} : { status: 'ACTIVE' },
      orderBy: { productName: 'asc' },
    });
  }

  async getProduct(id: string, actor: CatalogActor) {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (
      !product ||
      (actor.role !== 'SYSTEM_ADMIN' && product.status !== 'ACTIVE')
    ) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }

    return product;
  }

  createProduct(input: CreateProductDto, actor: CatalogActor) {
    this.assertAdmin(actor);

    return this.prisma.product.create({
      data: {
        productName: this.requiredName(input.productName),
        variety: input.variety?.trim(),
        defaultUnit: input.defaultUnit?.trim(),
        description: input.description?.trim(),
      },
    });
  }

  async updateProduct(
    id: string,
    input: UpdateProductDto,
    actor: CatalogActor,
  ) {
    this.assertAdmin(actor);
    await this.getProduct(id, actor);

    return this.prisma.product.update({
      where: { id },
      data: {
        productName:
          input.productName === undefined
            ? undefined
            : this.requiredName(input.productName),
        variety: input.variety?.trim(),
        defaultUnit: input.defaultUnit?.trim(),
        description: input.description?.trim(),
        status: input.status,
      },
    });
  }

  listFarms(actor: CatalogActor) {
    const organizationId = this.visibleOrganizationId(actor);

    return this.prisma.farm.findMany({
      where: organizationId ? { organizationId } : {},
      orderBy: { name: 'asc' },
    });
  }

  async getFarm(id: string, actor: CatalogActor) {
    const farm = await this.prisma.farm.findUnique({
      where: { id },
      include: { organization: true },
    });

    if (!farm) throw new NotFoundException('Không tìm thấy nông trại');

    this.assertVisibleOrganization(actor, farm.organizationId);
    return farm;
  }

  async createFarm(input: CreateFarmDto, actor: CatalogActor) {
    this.assertFarmManager(actor);

    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      input.organizationId !== undefined &&
      input.organizationId !== actor.organizationId
    ) {
      throw new ForbiddenException(
        'Không được tạo nông trại cho tổ chức khác',
      );
    }

    const organizationId =
      actor.role === 'SYSTEM_ADMIN'
        ? input.organizationId
        : actor.organizationId;

    if (!organizationId) {
      throw new BadRequestException('Thiếu organizationId');
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (
      !organization ||
      organization.type !== 'FARM' ||
      organization.status !== 'ACTIVE'
    ) {
      throw new UnprocessableEntityException(
        'Tổ chức phải là nông trại đang hoạt động',
      );
    }

    return this.prisma.farm.create({
      data: {
        organizationId,
        name: this.requiredName(input.name),
        location: input.location?.trim(),
      },
    });
  }

  async updateFarm(
    id: string,
    input: UpdateFarmDto,
    actor: CatalogActor,
  ) {
    this.assertFarmManager(actor);
    const farm = await this.getFarm(id, actor);

    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      farm.organization.status !== 'ACTIVE'
    ) {
      throw new ForbiddenException('Tổ chức hiện không hoạt động');
    }

    return this.prisma.farm.update({
      where: { id },
      data: {
        name:
          input.name === undefined
            ? undefined
            : this.requiredName(input.name),
        location: input.location?.trim(),
        status: input.status,
      },
    });
  }

  async listPlots(farmId: string, actor: CatalogActor) {
    await this.getFarm(farmId, actor);

    return this.prisma.plot.findMany({
      where: { farmId },
      orderBy: { name: 'asc' },
    });
  }

  async getPlot(id: string, actor: CatalogActor) {
    const plot = await this.prisma.plot.findUnique({
      where: { id },
      include: {
        farm: {
          include: { organization: true },
        },
      },
    });

    if (!plot) throw new NotFoundException('Không tìm thấy thửa đất');

    this.assertVisibleOrganization(actor, plot.farm.organizationId);
    return plot;
  }

  async createPlot(input: CreatePlotDto, actor: CatalogActor) {
    this.assertFarmManager(actor);
    const farm = await this.getFarm(input.farmId, actor);

    if (
      farm.status !== 'ACTIVE' ||
      farm.organization.status !== 'ACTIVE'
    ) {
      throw new ForbiddenException(
        'Nông trại hoặc tổ chức hiện không hoạt động',
      );
    }

    try {
      return await this.prisma.plot.create({
        data: {
          farmId: input.farmId,
          name: this.requiredName(input.name),
          area: input.area,
          unit: input.unit?.trim(),
          location: input.location?.trim(),
        },
      });
    } catch (error) {
      this.throwIfDuplicatePlot(error);
      throw error;
    }
  }

  async updatePlot(
    id: string,
    input: UpdatePlotDto,
    actor: CatalogActor,
  ) {
    this.assertFarmManager(actor);
    const plot = await this.getPlot(id, actor);

    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      plot.farm.organization.status !== 'ACTIVE'
    ) {
      throw new ForbiddenException('Tổ chức hiện không hoạt động');
    }

    try {
      return await this.prisma.plot.update({
        where: { id },
        data: {
          name:
            input.name === undefined
              ? undefined
              : this.requiredName(input.name),
          area: input.area,
          unit: input.unit?.trim(),
          location: input.location?.trim(),
          status: input.status,
        },
      });
    } catch (error) {
      this.throwIfDuplicatePlot(error);
      throw error;
    }
  }

  private assertAdmin(actor: CatalogActor): void {
    if (actor.role !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException('Chỉ quản trị viên được sửa sản phẩm');
    }
  }

  private assertFarmManager(actor: CatalogActor): void {
    if (!['SYSTEM_ADMIN', 'FARM_STAFF'].includes(actor.role)) {
      throw new ForbiddenException('Không có quyền quản lý nông trại');
    }
  }

  private visibleOrganizationId(actor: CatalogActor): string | null {
    if (actor.role === 'SYSTEM_ADMIN') return null;

    if (!actor.organizationId) {
      throw new ForbiddenException('Tài khoản chưa thuộc tổ chức');
    }

    return actor.organizationId;
  }

  private assertVisibleOrganization(
    actor: CatalogActor,
    organizationId: string,
  ): void {
    if (actor.role === 'SYSTEM_ADMIN') return;

    if (
      !actor.organizationId ||
      actor.organizationId !== organizationId
    ) {
      throw new ForbiddenException('Không có quyền xem dữ liệu tổ chức này');
    }
  }

  private requiredName(value: string): string {
    const name = value.trim();

    if (!name) {
      throw new BadRequestException('Tên không được để trống');
    }

    return name;
  }

  private throwIfDuplicatePlot(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Tên thửa đất đã tồn tại trong nông trại',
      );
    }
  }
}