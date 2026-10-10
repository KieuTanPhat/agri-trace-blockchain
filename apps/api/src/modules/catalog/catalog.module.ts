import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
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
  Req,
  UseGuards,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  IsNumber,
  IsPositive,
} from 'class-validator';
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
class ProductDto {
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  productName!: string;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  variety?: string;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  defaultUnit?: string;
}
class FarmDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  organizationId!: string;
  @ApiProperty({ type: String, maxLength: 255, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @ApiProperty({ type: String, required: false, nullable: true })
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
    nullable: true,
    minimum: 0,
    exclusiveMinimum: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  area?: number;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsString()
  location?: string;
}
@Controller('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'FARM_STAFF')
class CatalogController {
  constructor(
    private readonly db: PrismaService,
    private readonly idem: IdempotencyService,
  ) {}
  @ApiDataResponse(CatalogDto, 200)
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const where =
      req.user.role === 'SYSTEM_ADMIN'
        ? {}
        : {
            organizationId:
              req.user.organizationId ?? '00000000-0000-0000-0000-000000000000',
          };
    const [products, farms, plots] = await Promise.all([
      this.db.product.findMany({ orderBy: { productName: 'asc' } }),
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
  @Roles('SYSTEM_ADMIN')
  product(
    @Body() dto: ProductDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'CREATE_PRODUCT', dto, (tx) =>
      tx.product.create({ data: dto }),
    );
  }
  @ApiDataResponse(FarmRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('farms')
  @Roles('SYSTEM_ADMIN')
  farm(
    @Body() dto: FarmDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'CREATE_FARM', dto, async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (!org || org.type !== 'FARM' || org.status !== 'ACTIVE')
        throw new UnprocessableEntityException(
          'Chọn tổ chức nông trại đang hoạt động',
        );
      return tx.farm.create({ data: dto });
    });
  }
  @ApiDataResponse(PlotRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('plots')
  @Roles('SYSTEM_ADMIN')
  plot(
    @Body() dto: PlotDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'CREATE_PLOT', dto, async (tx) => {
      const farm = await tx.farm.findUnique({ where: { id: dto.farmId } });
      if (!farm || farm.status !== 'ACTIVE')
        throw new UnprocessableEntityException('Chọn nông trại đang hoạt động');
      return tx.plot.create({ data: dto });
    });
  }
}
@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [CatalogController],
})
export class CatalogModule {}
