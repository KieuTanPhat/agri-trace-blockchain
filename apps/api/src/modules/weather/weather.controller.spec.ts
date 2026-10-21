import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { vi } from 'vitest';
import { WeatherModule } from './weather.module.js';
import { WEATHER_CLOCK, WEATHER_FETCH } from './weather.service.js';
import { weatherFixture } from '../../../test/support/weather-fixture.js';
import { ApiResponseInterceptor } from '../../common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../../common/exception/global-exception.filter.js';
describe('Public weather HTTP contract without database access', () => {
  let app: INestApplication;
  const now = Date.UTC(2026, 9, 19, 5);
  const http = vi.fn(
    async () =>
      new Response(JSON.stringify(weatherFixture(now)), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        WeatherModule,
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          WEATHER_PROVIDER: 'OPEN_METEO',
          WEATHER_LICENSE_MODE: 'DEV_NONCOMMERCIAL',
          NODE_ENV: 'test',
        }),
      )
      .overrideProvider(WEATHER_FETCH)
      .useValue(http)
      .overrideProvider(WEATHER_CLOCK)
      .useValue(() => now)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('rejects missing/unknown province and arbitrary coordinates/URLs before provider access', async () => {
    for (const query of [
      '',
      '?province=xx',
      '?province=01&latitude=0',
      '?province=01&url=http://internal',
    ])
      await request(app.getHttpServer())
        .get(`/api/public/weather${query}`)
        .expect(400);
    expect(http).not.toHaveBeenCalled();
  });
  it('serves public, no-store, bounded forecasts and reuses the server cache', async () => {
    for (let i = 0; i < 2; i++) {
      const result = await request(app.getHttpServer())
        .get('/api/public/weather?province=01')
        .expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.data.daily).toHaveLength(3);
      expect(result.body.data.provinceCode).toBe('01');
      expect(JSON.stringify(result.body)).not.toContain('apikey');
    }
    expect(http).toHaveBeenCalledTimes(1);
  });
});
