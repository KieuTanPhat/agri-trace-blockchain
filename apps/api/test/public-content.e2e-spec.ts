import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PublicContentModule } from '../src/modules/public-content/public-content.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { NEWS_IMAGE_FETCH } from '../src/modules/public-content/news-image.js';

describe('Public consumer content / isolated PostgreSQL and HTTP', () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const url = new URL(connectionString);
  if (
    !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
    !/(test|_ci)/i.test(url.pathname)
  )
    throw new Error('Isolated local test database required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const tag = `NEWS-${randomUUID()}`;
  let app: INestApplication;
  let draft: string, future: string, visible: string;
  let baseline: { users: number; events: number; outbox: number };
  let imageCalls = 0;
  const get = (path: string) =>
    request(app.getHttpServer()).get(`/api/public/${path}`);
  beforeAll(async () => {
    baseline = {
      users: await db.user.count(),
      events: await db.traceEvent.count(),
      outbox: await db.blockchainOutbox.count(),
    };
    const create = (extra: object) =>
      db.consumerNews.create({
        data: {
          title: `${tag} title`,
          summary: 'Public summary',
          body: 'Plain text <script>alert(1)</script>',
          ...extra,
        },
      });
    draft = (await create({})).id;
    future = (
      await create({
        isPublished: true,
        publishedAt: new Date(Date.now() + 86400000),
      })
    ).id;
    const time = new Date('2026-01-01T00:00:00.000Z');
    visible = (
      await create({
        isPublished: true,
        publishedAt: time,
        coverUrl: 'https://not-allowed.invalid/image',
      })
    ).id;
    await create({ isPublished: true, publishedAt: time });
    for (const extra of [
      { isActive: true },
      { isActive: true },
      {
        isActive: true,
        startsAt: new Date('2019-01-01'),
        endsAt: new Date('2020-02-01'),
      },
      { isActive: false },
      { isActive: true, startsAt: new Date(Date.now() + 86400000) },
    ]) {
      await db.consumerAnnouncement.create({
        data: {
          title: `${tag} announcement`,
          body: 'Public notice',
          startsAt: time,
          ...extra,
        },
      });
    }
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
        PublicContentModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          PUBLIC_NEWS_IMAGE_HOSTS: 'images.fixture.invalid',
        }),
      )
      .overrideProvider(NEWS_IMAGE_FETCH)
      .useValue(async () => {
        imageCalls++;
        return {
          contentType: 'image/png',
          bytes: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWPgqLL/DwADEAHBRHIeYAAAAABJRU5ErkJggg==',
            'base64',
          ),
        };
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });
  it('lists only published, non-future news and returns no body/internal fields in lists', async () => {
    const response = await get(`news?q=${tag}`).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.items).toHaveLength(2);
    const item = response.body.data.items[0];
    expect(Object.keys(item).sort()).toEqual(
      ['id', 'title', 'summary', 'coverUrl', 'hasCover', 'publishedAt'].sort(),
    );
    expect(item.coverUrl).toBeNull();
    await get(`news/${draft}`).expect(404);
    await get(`news/${future}`).expect(404);
    const detail = (await get(`news/${visible}`).expect(200)).body.data;
    expect(detail.body).toBe('Plain text <script>alert(1)</script>');
  });
  it('uses a tie-breaker cursor and supports literal search without repeating rows', async () => {
    const first = (await get(`news?q=${tag}&limit=1`).expect(200)).body.data;
    expect(first.hasMore).toBe(true);
    const next = (
      await get(`news?q=${tag}&limit=1&cursor=${first.nextCursor}`).expect(200)
    ).body.data;
    expect(next.hasMore).toBe(false);
    expect(next.items[0].id).not.toBe(first.items[0].id);
    expect(
      (await get(`news?q=${encodeURIComponent(`${tag}%`)}`).expect(200)).body
        .data.items,
    ).toEqual([]);
    await get(`announcements?cursor=${first.nextCursor}`).expect(400);
  });
  it('returns only announcements in the active time window', async () => {
    const response = await get(`announcements?q=${tag}`).expect(200);
    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.items[0].endsAt).toBeNull();
    expect(response.body.data.items[0].severity).toBe('INFO');
    const first = (await get(`announcements?q=${tag}&limit=1`).expect(200)).body
      .data;
    const next = (
      await get(
        `announcements?q=${tag}&limit=1&cursor=${first.nextCursor}`,
      ).expect(200)
    ).body.data;
    expect(first.hasMore).toBe(true);
    expect(next.hasMore).toBe(false);
    expect(next.items[0].id).not.toBe(first.items[0].id);
  });
  it('rejects invalid queries and public writes; leaves accounts/events/outbox unchanged', async () => {
    for (const path of [
      'news?limit=51',
      'news?cursor=broken',
      'news?unknown=true',
      `news?q=${'x'.repeat(101)}`,
      'news/bad-id',
      'announcements?limit=0',
    ])
      await get(path).expect(400);
    expect((await get(`news?q=${randomUUID()}`).expect(200)).body.data).toEqual(
      { items: [], hasMore: false, nextCursor: null },
    );
    await request(app.getHttpServer())
      .post('/api/public/news')
      .send({ title: 'not allowed' })
      .expect(404);
    expect({
      users: await db.user.count(),
      events: await db.traceEvent.count(),
      outbox: await db.blockchainOutbox.count(),
    }).toEqual(baseline);
  });
  it('SQL constraints reject invalid publication and announcement windows', async () => {
    await expect(
      db.consumerNews.create({
        data: {
          title: 'Invalid',
          summary: 'test',
          body: 'test',
          isPublished: true,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.consumerAnnouncement.create({
        data: {
          title: 'Invalid',
          body: 'test',
          startsAt: new Date('2026-01-02'),
          endsAt: new Date('2026-01-01'),
        },
      }),
    ).rejects.toThrow();
  });
  it('serves only published allowlisted raster images and withdraws them even when cached', async () => {
    for (const id of [draft, future, visible])
      await get(`news/${id}/cover`).expect(404);
    await get('news/bad-id/cover').expect(400);
    expect(imageCalls).toBe(0);
    const row = await db.consumerNews.create({
      data: {
        title: `${tag}-image`,
        summary: 'Fixture',
        body: 'Fixture only',
        isPublished: true,
        publishedAt: new Date('2020-01-01'),
        coverUrl: 'https://images.fixture.invalid/test.png',
      },
    });
    const image = await get(`news/${row.id}/cover`).expect(200);
    expect(image.headers['cache-control']).toBe('no-store');
    expect(image.body.data).toMatchObject({
      mimeType: 'image/png',
      width: 1,
      height: 1,
    });
    expect(Object.keys(image.body.data).sort()).toEqual(
      ['mimeType', 'dataBase64', 'width', 'height'].sort(),
    );
    await get(`news/${row.id}/cover`).expect(200);
    expect(imageCalls).toBe(1);
    await db.consumerNews.update({
      where: { id: row.id },
      data: { isPublished: false },
    });
    await get(`news/${row.id}/cover`).expect(404);
    expect(imageCalls).toBe(1);
    expect({
      users: await db.user.count(),
      events: await db.traceEvent.count(),
      outbox: await db.blockchainOutbox.count(),
    }).toEqual(baseline);
  });
  it('throttles anonymous reads instead of allowing unbounded scraping', async () => {
    let status = 200;
    for (let attempt = 0; attempt < 61 && status === 200; attempt++)
      status = (await get(`news?q=${tag}`)).status;
    expect(status).toBe(429);
  });
});
