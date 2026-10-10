import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service.js';
import { ApiDataResponse } from './common/api/openapi.js';

@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  @ApiDataResponse('string')
  getHello(): string {
    return this.appService.getHello();
  }
}
