import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import {
  ConsumerController,
  MobileAuthController,
  MobileAuthGuard,
} from './mobile-auth.controller.js';
import { MobileAuthService } from './mobile-auth.service.js';
import { GlobalExceptionFilter } from '../../common/exception/global-exception.filter.js';

describe('Mobile auth IP throttle / no database', () => {
  let app: INestApplication;
  let calls = 0;
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true }),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 120 }]),
      ],
      controllers: [MobileAuthController],
      providers: [
        MobileAuthGuard,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: ConfigService, useValue: new ConfigService() },
        {
          provide: MobileAuthService,
          useValue: {
            enabled() {},
            async login() {
              calls++;
              return { fixture: true };
            },
          },
        },
      ],
    }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('allows 10 login attempts per minute/IP then rejects before calling the service', async () => {
    for (let index = 0; index < 10; index++)
      await request(app.getHttpServer())
        .post('/api/auth/mobile/login')
        .send({ phone: '0900000000', password: 'fixture' })
        .expect(201);
    const denied = await request(app.getHttpServer())
      .post('/api/auth/mobile/login')
      .send({ phone: '0900000000', password: 'fixture' })
      .expect(429);
    expect(denied.headers['retry-after']).toBeTruthy();
    expect(calls).toBe(10);
  });
  it('exports a separate consumer controller, not the browser cookie transport', () => {
    expect(ConsumerController).toBeDefined();
  });
});
