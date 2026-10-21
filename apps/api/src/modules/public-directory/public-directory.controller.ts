import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { PublicDirectoryService } from './public-directory.service.js';
import {
  PublicEnterprisesPageDto,
  PublicEnterprisesQueryDto,
  PublicEnterpriseDetailDto,
  PublicEnterpriseDetailQueryDto,
  PublicProductDetailDto,
  PublicProductDetailQueryDto,
  PublicProductsPageDto,
  PublicProductsQueryDto,
} from './dto.js';

@ApiTags('public-directory')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('public')
export class PublicDirectoryController {
  constructor(private readonly service: PublicDirectoryService) {}

  @Get('products')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Sản phẩm đang hoạt động có Lot với QR công khai' })
  @ApiDataResponse(PublicProductsPageDto)
  products(@Query() query: PublicProductsQueryDto) {
    return this.service.products(query);
  }

  @Get('products/:id')
  @Header('Cache-Control', 'no-store')
  @ApiDataResponse(PublicProductDetailDto)
  product(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PublicProductDetailQueryDto,
  ) {
    return this.service.product(id, query);
  }

  @Get('enterprises')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Doanh nghiệp hoạt động liên quan trực tiếp đến Lot công khai',
  })
  @ApiDataResponse(PublicEnterprisesPageDto)
  enterprises(@Query() query: PublicEnterprisesQueryDto) {
    return this.service.enterprises(query);
  }

  @Get('enterprises/:id')
  @Header('Cache-Control', 'no-store')
  @ApiDataResponse(PublicEnterpriseDetailDto)
  enterprise(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PublicEnterpriseDetailQueryDto,
  ) {
    return this.service.enterprise(id, query);
  }
}
