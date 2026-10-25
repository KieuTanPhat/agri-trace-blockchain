import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorEnvelopeDto } from '../../common/api/api-error.dto.js';
import { Throttle } from '@nestjs/throttler';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { PublicWeatherDto, WeatherQueryDto } from './dto.js';
import { WeatherService } from './weather.service.js';
@ApiTags('public-weather')
@Controller('public')
export class WeatherController {
  constructor(private readonly service: WeatherService) {}
  @Get('weather')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiDataResponse(PublicWeatherDto)
  @ApiResponse({
    status: 502,
    type: ApiErrorEnvelopeDto,
    description: 'Weather provider unavailable or returned unsupported data.',
  })
  get(@Query() query: WeatherQueryDto) {
    return this.service.get(query.province);
  }
}
