import { ApiHeader } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import {
  ProductRecordDto,
  FarmRecordDto,
  PlotRecordDto,
} from '../../common/api/record.dto.js';
import { CatalogDto } from '../../common/api/response.dto.js';
import { ApiProperty } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Param,
  ParseUUIDPipe,
  ConflictException,
  Req,
  UseGuards,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  IsEmail,
  IsIn,
  Matches,
  IsArray,
  ArrayUnique,
  ArrayMaxSize,
} from 'class-validator';
import { AREA_UNITS, areaInM2 } from '../../common/area.js';
import { Transform, Type } from 'class-transformer';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import { assertFarmRefs, assertProductRefs } from './product-refs.js';
import { assertEntitlement } from '../billing/billing-core.js';
class ProductDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @MinLength(2) @MaxLength(100) category!: string;
  @ApiProperty({ required: false, format: 'uuid', description: 'Origin farm. Required for producers; processors give manufacturingSiteId instead.' }) @IsOptional() @IsUUID() originFarmId?: string;
  @ApiProperty({ required: false, type: Number, minimum: 0 }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price?: number;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MinLength(2) @MaxLength(2000) storageConditions!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MinLength(2) @MaxLength(2000) ingredients!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MinLength(2) @MaxLength(2000) usageInstructions!: string;
  @ApiProperty({ required: false, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) rawMaterials?: string;
  @ApiProperty({ required: false, format: 'uuid', description: 'Manufacturing site of the organization' }) @IsOptional() @IsUUID() manufacturingSiteId?: string;
  @ApiProperty({ required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) exporter?: string;
  @ApiProperty({ required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) importer?: string;
  @ApiProperty({ required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) distributor?: string;
  @ApiProperty({ required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) carrier?: string;
  @ApiProperty({ required: false, format: 'uuid', description: 'Member managing the product' }) @IsOptional() @IsUUID() managerUserId?: string;
  @ApiProperty({ type: String, required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;
  @ApiProperty({
    type: String,
    required: false,
    description: 'GTIN digits, syntax only; no registry verification',
  })
  @IsOptional()
  @Matches(/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/)
  gtin?: string;
  @ApiProperty({ type: String, required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  productName!: string;
  @ApiProperty({ type: String, required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  variety?: string;
  @ApiProperty({ type: String, required: false, maxLength: 30 })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  defaultUnit!: string;
}
class FarmDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @MinLength(2) @MaxLength(100) kind!: string;
  @ApiProperty({ maxLength: 255 }) @IsString() @MinLength(2) @MaxLength(255) region!: string;
  @ApiProperty({ maxLength: 500 }) @IsString() @MinLength(5) @MaxLength(500) address!: string;
  @ApiProperty({ type: Number, minimum: 0, exclusiveMinimum: true }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() areaM2!: number;
  @ApiProperty({ type: Number, minimum: 0, exclusiveMinimum: true }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() expectedOutput!: number;
  @ApiProperty({ maxLength: 30 }) @IsString() @MinLength(1) @MaxLength(30) outputUnit!: string;
  @ApiProperty({ enum: ['PRIVATE','PUBLIC'] }) @IsIn(['PRIVATE','PUBLIC']) privacy!: string;
  @ApiProperty({ required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) representative?: string;
  @ApiProperty({ required: false, maxLength: 30 }) @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiProperty({ required: false, format: 'email' }) @IsOptional() @IsEmail() email?: string;
  @ApiProperty({ required: false, maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) otherInfo?: string;
  @ApiProperty({ required: false, maxLength: 100, description: 'Mã vụ trồng của vùng (không bắt buộc)' }) @IsOptional() @IsString() @MaxLength(100) cropCode?: string;
  @ApiProperty({ required: false, type: String, isArray: true, format: 'uuid', description: 'Vật tư đầu vào (không phải giống) của doanh nghiệp' })
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsUUID('all', { each: true }) inputMaterialIds?: string[];
  @ApiProperty({ required: false, type: String, isArray: true, format: 'uuid', description: 'Giống của doanh nghiệp' })
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsUUID('all', { each: true }) seedMaterialIds?: string[];
  @ApiProperty({ required: false, format: 'uuid', description: 'Nhà xưởng / cơ sở liên kết đang hoạt động' }) @IsOptional() @IsUUID() linkedSiteId?: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  organizationId!: string;
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  location?: string;
}
class PlotDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  farmId!: string;
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @ApiProperty({
    type: Number,
    required: false,
    minimum: 0,
    exclusiveMinimum: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  area?: number;
  @ApiProperty({ type: String, required: false, enum: Object.keys(AREA_UNITS), description: 'Mặc định m2' })
  @IsOptional()
  @IsIn(Object.keys(AREA_UNITS))
  unit?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  location?: string;
}
class CompleteEvidenceDto {
  @ApiProperty({ minimum: 0 }) @Type(() => Number) @IsInt() @Min(0) version!: number;
}
async function evidenceCounts(tx: Prisma.TransactionClient, organizationId: string, entityType: string, entityId: string) {
  const rows = await tx.traceEvidence.findMany({ where: { organizationId, entityType, entityId, withdrawal: null }, select: { id: true, kind: true, supersedesId: true } });
  const superseded = new Set(rows.map((row) => row.supersedesId).filter(Boolean));
  const counts = new Map<string, number>();
  for (const row of rows) if (!superseded.has(row.id)) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  return counts;
}
@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'FARM_STAFF')
class CatalogController {
  constructor(
    private readonly db: PrismaService,
    private readonly idem: IdempotencyService,
  ) {}
  @ApiDataResponse(CatalogDto, 200)
  @Get()
  @Roles(
    'SYSTEM_ADMIN',
    'FARM_STAFF',
    'TRANSPORTER',
    'DISTRIBUTOR',
    'RETAILER',
    'PROCESSOR',
    'AUDITOR',
    'COMPLIANCE_REVIEWER',
  )
  async list(@Req() req: AuthenticatedRequest) {
    const enterpriseUser = await this.db.user.findUnique({
      where: { id: req.user.sub },
      select: { enterpriseTier: true },
    });
    if (enterpriseUser?.enterpriseTier && enterpriseUser.enterpriseTier > 1)
      await enterpriseAuthority(this.db, req.user, 'catalog.read');
    if (
      !['SYSTEM_ADMIN', 'FARM_STAFF'].includes(req.user.role) &&
      !(await this.db.scopedRoleGrant.findFirst({
        where: {
          userId: req.user.sub,
          organizationId:
            req.user.organizationId ?? '00000000-0000-0000-0000-000000000000',
          role: 'FARM_STAFF',
          scope: 'CHAIN',
          revokedAt: null,
          chain: { is: { businessProfile: { is: { state: 'ACTIVE' } } } },
          membership: { is: { status: 'ACTIVE' } },
          organization: {
            status: 'ACTIVE',
            capabilities: { some: { code: 'FARM', revokedAt: null } },
          },
        },
      }))
    )
      await enterpriseAuthority(this.db, req.user, 'catalog.read');
    const catalogAuth = enterpriseUser?.enterpriseTier && enterpriseUser.enterpriseTier > 1 ? await enterpriseAuthority(this.db,req.user,'catalog.read') : null;
    const where =
      req.user.role === 'SYSTEM_ADMIN'
        ? {}
        : {
            organizationId:
              req.user.organizationId ?? '00000000-0000-0000-0000-000000000000',
            ...(catalogAuth && !catalogAuth.primary ? {id:{in:catalogAuth.matching.flatMap(r=>r.siteIds)}} : {}),
          };
    const [products, farms, plots] = await Promise.all([
      this.db.product.findMany({
        where:
          req.user.role === 'SYSTEM_ADMIN'
            ? {}
            : {
                OR: [
                  { organizationId: null },
                  { organizationId: req.user.organizationId },
                ],
              },
        orderBy: { productName: 'asc' },
      }),
      this.db.farm.findMany({
        where,
        include: { organization: true },
        orderBy: { name: 'asc' },
      }),
      this.db.plot.findMany({
        where: { farm: where },
        include: { farm: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { products, farms, plots };
  }
  private run(
    key: string,
    req: AuthenticatedRequest,
    operation: string,
    payload: unknown,
    command: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation,
        payload,
        requestType: 'COMMAND',
      },
      () => commandTransaction(this.db, command),
    );
  }
  @ApiDataResponse(ProductRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('products')
  @Roles('FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'DISTRIBUTOR', 'PROCESSOR')
  product(
    @Body() dto: ProductDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'EW_CREATE_PRODUCT', dto, async (tx) => {
      await enterpriseAuthority(
        tx,
        req.user,
        'catalog.manage',
        undefined,
        dto.originFarmId ?? dto.manufacturingSiteId,
        true,
      );
      if (dto.originFarmId) {
        const farm = await tx.farm.findFirst({ where: { id: dto.originFarmId, organizationId: req.user.organizationId!, status: 'ACTIVE', evidenceComplete: true } });
        if (!farm) throw new UnprocessableEntityException('Vùng sản xuất chưa hoàn tất hồ sơ ảnh hoặc ngoài doanh nghiệp');
      } else {
        // Processed products originate at a processing/packing site of a processor.
        const processor = await tx.organizationCapability.findFirst({ where: { organizationId: req.user.organizationId!, code: 'PROCESSOR', revokedAt: null } });
        const site = dto.manufacturingSiteId ? await tx.enterpriseSite.findFirst({ where: { id: dto.manufacturingSiteId, organizationId: req.user.organizationId!, status: 'ACTIVE', kind: { in: ['PROCESSING', 'PACKING'] } } }) : null;
        if (!processor || !site) throw new UnprocessableEntityException('Sản phẩm cần vùng sản xuất; nhà chế biến chọn cơ sở chế biến/đóng gói đang hoạt động');
      }
      await assertProductRefs(tx, req.user.organizationId!, dto);
      return tx.product.create({
        data: {
          ...dto,
          sku: dto.sku?.trim() || `SP-${randomUUID().slice(0, 12).toUpperCase()}`,
          evidenceComplete: false,
          status: 'INACTIVE',
          organizationId: req.user.organizationId,
        },
      });
    });
  }
  @ApiDataResponse(ProductRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('products/:id/complete')
  @Roles('FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'DISTRIBUTOR', 'PROCESSOR')
  completeProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteEvidenceDto, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.run(key, req, 'EW_COMPLETE_PRODUCT', { id, ...dto }, async (tx) => {
      const row = await tx.product.findFirst({ where: { id, organizationId: req.user.organizationId! } });
      if (!row || row.version !== dto.version || row.evidenceComplete) throw new ConflictException('Sản phẩm đã thay đổi hoặc hoàn tất');
      await enterpriseAuthority(tx, req.user, 'catalog.manage', undefined, row.originFarmId ?? undefined, true);
      const counts = await evidenceCounts(tx, req.user.organizationId!, 'PRODUCT', id);
      if ((counts.get('PRODUCT_IMAGE') ?? 0) < 3) throw new ConflictException('Cần ít nhất ba ảnh sản phẩm hợp lệ');
      await assertEntitlement(tx, req.user.organizationId!, 'products');
      const updated = await tx.product.updateMany({ where: { id, version: dto.version, evidenceComplete: false }, data: { evidenceComplete: true, status: 'ACTIVE', version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Sản phẩm đã thay đổi');
      return tx.product.findUniqueOrThrow({ where: { id } });
    });
  }
  @ApiDataResponse(FarmRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('farms')
  @Roles('FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'DISTRIBUTOR')
  farm(
    @Body() dto: FarmDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'EW_CREATE_FARM', dto, async (tx) => {
      await enterpriseAuthority(
        tx,
        req.user,
        'catalog.manage',
        undefined,
        undefined,
        true,
      );
      if (dto.organizationId !== req.user.organizationId)
        throw new ForbiddenException('Ngoài doanh nghiệp');
      const org = await tx.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (
        !org ||
        org.status !== 'ACTIVE' ||
        !(await tx.organizationCapability.findFirst({
          where: { organizationId: org.id, code: 'FARM', revokedAt: null },
        }))
      )
        throw new UnprocessableEntityException(
          'Chọn tổ chức nông trại đang hoạt động',
        );
      await assertFarmRefs(tx, dto.organizationId, dto);
      return tx.farm.create({ data: {
        ...dto,
        location: dto.location ?? dto.address,
        internalCode: `VUNG-${randomUUID().slice(0, 12).toUpperCase()}`,
        evidenceComplete: false,
        status: 'INACTIVE',
      } });
    });
  }
  @ApiDataResponse(FarmRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('farms/:id/complete')
  @Roles('FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'DISTRIBUTOR')
  completeFarm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteEvidenceDto, @IdempotencyKey() key: string, @Req() req: AuthenticatedRequest) {
    return this.run(key, req, 'EW_COMPLETE_FARM', { id, ...dto }, async (tx) => {
      const row = await tx.farm.findFirst({ where: { id, organizationId: req.user.organizationId! } });
      if (!row || row.version !== dto.version || row.evidenceComplete) throw new ConflictException('Vùng sản xuất đã thay đổi hoặc hoàn tất');
      await enterpriseAuthority(tx, req.user, 'catalog.manage', undefined, id, true);
      const counts = await evidenceCounts(tx, req.user.organizationId!, 'FARM', id);
      // A farm needs only its land-use right document (26/10/2026).
      if ((counts.get('LAND_CERTIFICATE') ?? 0) < 1) throw new ConflictException('Cần ảnh giấy quyền sử dụng đất của vùng sản xuất');
      const updated = await tx.farm.updateMany({ where: { id, version: dto.version, evidenceComplete: false }, data: { evidenceComplete: true, status: 'ACTIVE', version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Vùng sản xuất đã thay đổi');
      return tx.farm.findUniqueOrThrow({ where: { id } });
    });
  }
  @ApiDataResponse(PlotRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('plots')
  @Roles('FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'DISTRIBUTOR')
  plot(
    @Body() dto: PlotDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'EW_CREATE_PLOT', dto, async (tx) => {
      const farm = await tx.farm.findUnique({ where: { id: dto.farmId } });
      await enterpriseAuthority(
        tx,
        req.user,
        'catalog.manage',
        undefined,
        dto.farmId,
        true,
      );
      if (farm?.organizationId !== req.user.organizationId)
        throw new ForbiddenException('Ngoài doanh nghiệp');
      if (!farm || farm.status !== 'ACTIVE')
        throw new UnprocessableEntityException('Chọn nông trại đang hoạt động');
      await tx.$queryRaw`SELECT farm_id FROM farm WHERE farm_id = ${farm.id}::uuid FOR UPDATE`;
      const areaM2 = areaInM2(dto.area, dto.unit);
      if (areaM2 !== null && farm.areaM2 !== null) {
        const others = await tx.plot.findMany({
          where: { farmId: farm.id, status: 'ACTIVE' },
          select: { area: true, unit: true },
        });
        const used = others.reduce((sum, p) => sum + (areaInM2(p.area, p.unit) ?? 0), 0);
        if (used + areaM2 > Number(farm.areaM2))
          throw new UnprocessableEntityException(
            `Tổng diện tích các thửa vượt diện tích vùng sản xuất (${Number(farm.areaM2)} m², đã dùng ${used} m²)`,
          );
      }
      return tx.plot.create({ data: { ...dto, unit: dto.unit ?? 'm2' } });
    });
  }
}
@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [CatalogController],
})
export class CatalogModule {}
