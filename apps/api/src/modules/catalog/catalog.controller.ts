import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CatalogService } from './catalog.service.js';
import {
  CreateFarmDto,
  CreatePlotDto,
  CreateProductDto,
  UpdateFarmDto,
  UpdatePlotDto,
  UpdateProductDto,
} from './dto.js';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('products')
  listProducts(@Req() req: AuthenticatedRequest) {
    return this.catalog.listProducts(req.user);
  }

  @Get('products/:id')
  getProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.getProduct(id, req.user);
  }

  @Roles('SYSTEM_ADMIN')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('products')
  createProduct(
    @Body() dto: CreateProductDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        operation: 'CREATE_PRODUCT',
        requestType: 'COMMAND',
        payload: dto,
      },
      () => this.catalog.createProduct(dto, req.user),
    );
  }

  @Roles('SYSTEM_ADMIN')
  @Patch('products/:id')
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.updateProduct(id, dto, req.user);
  }

  @Get('farms')
  listFarms(@Req() req: AuthenticatedRequest) {
    return this.catalog.listFarms(req.user);
  }

  @Get('farms/:id')
  getFarm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.getFarm(id, req.user);
  }

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('farms')
  createFarm(
    @Body() dto: CreateFarmDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        operation: 'CREATE_FARM',
        requestType: 'COMMAND',
        payload: dto,
      },
      () => this.catalog.createFarm(dto, req.user),
    );
  }

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @Patch('farms/:id')
  updateFarm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFarmDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.updateFarm(id, dto, req.user);
  }

  @Get('farms/:farmId/plots')
  listPlots(
    @Param('farmId', ParseUUIDPipe) farmId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.listPlots(farmId, req.user);
  }

  @Get('plots/:id')
  getPlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.getPlot(id, req.user);
  }

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('plots')
  createPlot(
    @Body() dto: CreatePlotDto,
    @Headers('idempotency-key') key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idempotency.execute(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        operation: 'CREATE_PLOT',
        requestType: 'COMMAND',
        payload: dto,
      },
      () => this.catalog.createPlot(dto, req.user),
    );
  }

  @Roles('SYSTEM_ADMIN', 'FARM_STAFF')
  @Patch('plots/:id')
  updatePlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlotDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.updatePlot(id, dto, req.user);
  }
}