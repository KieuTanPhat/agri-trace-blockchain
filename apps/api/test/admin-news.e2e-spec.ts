import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { newSessionIds } from './support/session.js';
describe('Admin news lifecycle / isolated PostgreSQL', () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/test|_ci/i.test(url.pathname)
  )
    throw new Error('Isolated test database required');
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.href }),
  });
  let app: INestApplication, admin: string, auditor: string, id: string;
  const content = {
    title: 'Tin mới ' + randomUUID(),
    summary: 'Nông sản trong mùa thu hoạch',
    body: 'Thông tin mùa vụ và cách bảo quản sản phẩm.',
  };
  const post = (
    token: string,
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post('/api/platform-admin/news' + path)
      .set('Authorization', 'Bearer ' + token)
      .set('Idempotency-Key', key)
      .send(body);
  const publicGet = (path = '') =>
    request(app.getHttpServer()).get('/api/public/news' + path);
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'news-tests-only-signing-secret',
        get: (_key: string, fallback: unknown) => fallback,
      })
      .compile();
    app = m.createNestApplication();
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
    const jwt = app.get(JwtService);
    const actor = async (code: string) => {
      const role = await db.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      const u = await db.user.create({
        data: {
          email: `news-${randomUUID()}@example.test`,
          fullName: code,
          passwordHash: 'unused',
          roleId: role.id,
        },
      });
      const s = await db.refreshSession.create({
        data: {
          ...newSessionIds(),
          userId: u.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return jwt.sign({ sub: u.id, sid: s.id });
    };
    admin = await actor('SYSTEM_ADMIN');
    auditor = await actor('AUDITOR');
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });
  it('requires an admin and keeps drafts private; replays the same command once', async () => {
    await request(app.getHttpServer())
      .get('/api/platform-admin/news')
      .expect(401);
    await post(auditor, '', content).expect(403);
    const key = randomUUID(),
      created = await post(admin, '', content, key).expect(201);
    id = created.body.data.id;
    const replay = await post(admin, '', content, key).expect(201);
    expect(replay.body.data.id).toBe(id);
    expect(
      await db.consumerNews.count({ where: { title: content.title } }),
    ).toBe(1);
    await publicGet('/' + id).expect(404);
    expect(
      await db.platformAudit.count({
        where: { subjectId: id, action: 'PLATFORM_NEWS_CREATE' },
      }),
    ).toBe(1);
  });
  it('publishes and withdraws the same source read by mobile, rejecting stale edits', async () => {
    await post(admin, '/' + id + '/status', {
      action: 'PUBLISH',
      version: 0,
    }).expect(201);
    const shown = await publicGet('/' + id).expect(200);
    expect(shown.body.data.title).toBe(content.title);
    await post(admin, '/' + id, { ...content, version: 0 }).expect(409);
    await post(admin, '/' + id + '/status', {
      action: 'WITHDRAW',
      version: 1,
    }).expect(201);
    await publicGet('/' + id).expect(404);
    await publicGet('/' + id + '/cover').expect(404);
    await post(admin, '/' + id + '/status', {
      action: 'ARCHIVE',
      version: 2,
    }).expect(201);
    const list = await request(app.getHttpServer())
      .get('/api/platform-admin/news')
      .set('Authorization', 'Bearer ' + admin)
      .expect(200);
    expect(list.body.data.items.some((n: { id: string }) => n.id === id)).toBe(
      false,
    );
  });
  it('rejects mismatched image types and avoids creating any article', async () => {
    await post(admin, '', {
      ...content,
      coverMimeType: 'image/png',
      coverBase64: Buffer.from('not a PNG').toString('base64'),
    }).expect(400);
    expect(
      await db.consumerNews.count({ where: { title: content.title } }),
    ).toBe(1);
  });
});
