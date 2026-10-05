import 'dotenv/config';
import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Media API with PostgreSQL and local files', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let farmToken: string;
  let productId: string;
  const createdIds: string[] = [];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sT6hZkAAAAASUVORK5CYII=',
    'base64',
  );

  beforeAll(async () => {
    process.env.ALERT_SCAN_ENABLED = 'false';
    process.env.FABRIC_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();

    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: { code: 'SYSTEM_ADMIN' }, accountStatus: 'ACTIVE' },
      include: { role: true },
    });
    const farm = await prisma.user.findFirstOrThrow({
      where: { role: { code: 'FARM_STAFF' }, accountStatus: 'ACTIVE' },
      include: { role: true },
    });
    const product = await prisma.product.findFirstOrThrow();
    productId = product.id;
    adminToken = jwt.sign({ sub: admin.id, email: admin.email, role: admin.role.code });
    farmToken = jwt.sign({ sub: farm.id, email: farm.email, role: farm.role.code });
  });

  afterAll(async () => {
    for (const id of createdIds) {
      const asset = await prisma.mediaAsset.findUnique({ where: { id } });
      if (!asset) continue;
      await prisma.mediaAsset.delete({ where: { id } });
      await unlink(join(resolve(process.env.MEDIA_STORAGE_DIR ?? join(process.cwd(), 'uploads')), asset.storageKey)).catch(() => undefined);
    }
    await app?.close();
  });

  it('uploads a public product image and serves identical bytes and SHA-256', async () => {
    const uploaded = await request(app.getHttpServer())
      .post('/api/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('kind', 'PRODUCT_IMAGE')
      .field('visibility', 'PUBLIC')
      .field('productId', productId)
      .attach('file', png, { filename: 'sample.png', contentType: 'image/png' });

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    const id: string = uploaded.body.data.id;
    createdIds.push(id);

    const publicMetadata = await request(app.getHttpServer()).get(`/api/public/media/${id}`);
    expect(publicMetadata.status).toBe(200);
    expect(publicMetadata.body.data.contentUrl).toBe(`/api/public/media/${id}/content`);

    const content = await request(app.getHttpServer()).get(`/api/public/media/${id}/content`);
    expect(content.status).toBe(200);
    expect(content.headers['content-type']).toMatch(/image\/png/);
    expect(content.headers['x-content-sha256']).toBe(uploaded.body.data.sha256);
    expect(content.body).toEqual(png);
  });

  it('keeps a private product image hidden from anonymous and farm users', async () => {
    const uploaded = await request(app.getHttpServer())
      .post('/api/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('kind', 'PRODUCT_IMAGE')
      .field('productId', productId)
      .attach('file', png, { filename: 'private.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);
    const id: string = uploaded.body.data.id;
    createdIds.push(id);

    expect((await request(app.getHttpServer()).get(`/api/public/media/${id}`)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(`/api/media/${id}`).set('Authorization', `Bearer ${farmToken}`)).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`/api/media/${id}`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
  });

  it('rejects a file whose declared MIME type does not match its bytes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('kind', 'PRODUCT_IMAGE')
      .field('productId', productId)
      .attach('file', png, { filename: 'fake.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(400);
  });
});
