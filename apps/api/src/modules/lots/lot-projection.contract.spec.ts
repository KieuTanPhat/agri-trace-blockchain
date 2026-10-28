import { type INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { vi } from 'vitest';
import { ApiResponseInterceptor } from '../../common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../../common/exception/global-exception.filter.js';
import { PublicTraceController } from './lots.controller.js';
import { LotQueryService } from './lot-query.service.js';
import { PublicJourneyService } from './public-journey.service.js';

describe('Public trace token HTTP contract', () => {
  let app: INestApplication;
  const getPublic = vi.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicTraceController],
      providers: [
        { provide: LotQueryService, useValue: { getPublic } },
        { provide: PublicJourneyService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  beforeEach(() => {
    getPublic.mockReset();
  });
  afterAll(async () => app.close());

  it.each(['short', 'x'.repeat(129), 'invalid token', 'invalid.token'])(
    'rejects malformed token %s before querying storage',
    async (token) => {
      const response = await request(app.getHttpServer())
        .get(`/public/trace/${encodeURIComponent(token)}`)
        .expect(400);
      expect(response.body).toMatchObject({
        success: false,
        error: { message: 'Mã truy xuất không hợp lệ' },
      });
      expect(getPublic).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for an unknown well-formed token', async () => {
    getPublic.mockRejectedValue(
      new NotFoundException('Mã truy xuất không hợp lệ'),
    );
    const response = await request(app.getHttpServer())
      .get('/public/trace/unknown-token')
      .expect(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { message: 'Mã truy xuất không hợp lệ' },
    });
    expect(getPublic).toHaveBeenCalledWith('unknown-token');
  });

  it.each(['a'.repeat(8), 'Z_9-'.repeat(32)])(
    'passes valid token unchanged and disables caching',
    async (token) => {
      getPublic.mockResolvedValue({ traceToken: token });
      const response = await request(app.getHttpServer())
        .get(`/public/trace/${token}`)
        .expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        success: true,
        data: { traceToken: token },
      });
      expect(getPublic).toHaveBeenCalledWith(token);
    },
  );
});
