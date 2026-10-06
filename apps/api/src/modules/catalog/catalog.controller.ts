import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { ProductDto, FarmDto, PlotDto } from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';
@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'FARM_STAFF')
export class CatalogController {
  constructor(
    private readonly service: CatalogService,
    private readonly idem: IdempotencyService,
  ) {}
  @Get() list(@Req() req: AuthenticatedRequest) {
    return this.service.list(req.user);
  }
  private run(
    key: string,
    req: AuthenticatedRequest,
    operation: string,
    payload: unknown,
    command: () => Promise<unknown>,
  ) {
    return this.idem.execute(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        operation,
        payload,
        requestType: 'COMMAND',
      },
      command,
    );
  }
  @Post('products') @Roles('SYSTEM_ADMIN') product(
    @Body() dto: ProductDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'CREATE_PRODUCT', dto, () =>
      this.service.createProduct(dto),
    );
  }
  @Post('farms') @Roles('SYSTEM_ADMIN') farm(
    @Body() dto: FarmDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'CREATE_FARM', dto, () =>
      this.service.createFarm(dto),
    );
  }
  @Post('plots') @Roles('SYSTEM_ADMIN') plot(
    @Body() dto: PlotDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run(key, req, 'CREATE_PLOT', dto, () =>
      this.service.createPlot(dto, req.user),
    );
  }
}
