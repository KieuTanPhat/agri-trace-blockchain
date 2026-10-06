import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

(testDatabaseUrl ? describe : describe.skip)(
  'Media API with PostgreSQL and local files',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let adminToken: string;
    let farmToken: string;
    let productId: string;
    let storageDirectory: string | undefined;
    let fixture:
      | {
          productId: string;
          organizationId: string;
          adminId: string;
          farmId: string;
        }
      | undefined;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sT6hZkAAAAASUVORK5CYII=',
      'base64',
    );

    beforeAll(async () => {
      storageDirectory = await mkdtemp(join(tmpdir(), 'agri-trace-media-e2e-'));
      vi.stubEnv('MEDIA_STORAGE_DIR', storageDirectory);
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useFactory({
          factory: () =>
            new PrismaService(
              new ConfigService({ DATABASE_URL: testDatabaseUrl }),
            ),
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
      app.useGlobalFilters(new GlobalExceptionFilter());
      app.useGlobalInterceptors(new ApiResponseInterceptor());
      await app.init();

      prisma = app.get(PrismaService);
      const jwt = app.get(JwtService);
      fixture = await prisma.$transaction(async (tx) => {
        const tag = randomUUID();
        const adminRole = await tx.role.findUniqueOrThrow({
          where: { code: 'SYSTEM_ADMIN' },
        });
        const farmRole = await tx.role.findUniqueOrThrow({
          where: { code: 'FARM_STAFF' },
        });
        const organization = await tx.organization.create({
          data: {
            name: `Media E2E farm ${tag}`,
            type: 'FARM',
            status: 'ACTIVE',
          },
        });
        const admin = await tx.user.create({
          data: {
            email: `media-admin-${tag}@example.local`,
            fullName: 'Media E2E admin',
            passwordHash: 'media-e2e-unused-password-hash',
            roleId: adminRole.id,
            accountStatus: 'ACTIVE',
          },
        });
        const farm = await tx.user.create({
          data: {
            email: `media-farm-${tag}@example.local`,
            fullName: 'Media E2E farm staff',
            passwordHash: 'media-e2e-unused-password-hash',
            roleId: farmRole.id,
            organizationId: organization.id,
            accountStatus: 'ACTIVE',
          },
        });
        const product = await tx.product.create({
          data: {
            productName: `Media E2E product ${tag}`,
            defaultUnit: 'kg',
            status: 'ACTIVE',
          },
        });
        return {
          productId: product.id,
          organizationId: organization.id,
          adminId: admin.id,
          farmId: farm.id,
        };
      });
      productId = fixture.productId;
      adminToken = jwt.sign({ sub: fixture.adminId });
      farmToken = jwt.sign({ sub: fixture.farmId });
    });

    afterAll(async () => {
      try {
        const createdFixture = fixture;
        if (createdFixture) {
          await prisma.$transaction(async (tx) => {
            // Delete every upload for this fixture, including uploads made before a failed assertion.
            await tx.mediaAsset.deleteMany({
              where: { productId: createdFixture.productId },
            });
            await tx.user.deleteMany({
              where: {
                id: { in: [createdFixture.adminId, createdFixture.farmId] },
              },
            });
            await tx.product.delete({
              where: { id: createdFixture.productId },
            });
            await tx.organization.delete({
              where: { id: createdFixture.organizationId },
            });
          });
        }
      } finally {
        try {
          await app?.close();
        } finally {
          if (storageDirectory)
            await rm(storageDirectory, { recursive: true, force: true });
          vi.unstubAllEnvs();
        }
      }
    });

    it('uploads a public product image and serves identical bytes and SHA-256', async () => {
      const uploaded = await request(app.getHttpServer())
        .post('/api/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('kind', 'PRODUCT_IMAGE')
        .field('visibility', 'PUBLIC')
        .field('productId', productId)
        .attach('file', png, {
          filename: 'sample.png',
          contentType: 'image/png',
        });

      expect(uploaded.status).toBe(201);
      expect(uploaded.body.data.sha256).toBe(
        createHash('sha256').update(png).digest('hex'),
      );
      const id: string = uploaded.body.data.id;

      const publicMetadata = await request(app.getHttpServer()).get(
        `/api/public/media/${id}`,
      );
      expect(publicMetadata.status).toBe(200);
      expect(publicMetadata.body.data.contentUrl).toBe(
        `/api/public/media/${id}/content`,
      );

      const content = await request(app.getHttpServer()).get(
        `/api/public/media/${id}/content`,
      );
      expect(content.status).toBe(200);
      expect(content.headers['content-type']).toMatch(/image\/png/);
      expect(content.headers['x-content-sha256']).toBe(
        uploaded.body.data.sha256,
      );
      expect(content.body).toEqual(png);
    });

    it('keeps a private product image hidden from anonymous and farm users', async () => {
      const uploaded = await request(app.getHttpServer())
        .post('/api/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('kind', 'PRODUCT_IMAGE')
        .field('productId', productId)
        .attach('file', png, {
          filename: 'private.png',
          contentType: 'image/png',
        });
      expect(uploaded.status).toBe(201);
      const id: string = uploaded.body.data.id;

      expect(
        (await request(app.getHttpServer()).get(`/api/public/media/${id}`))
          .status,
      ).toBe(404);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/media/${id}`)
            .set('Authorization', `Bearer ${farmToken}`)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/media/${id}`)
            .set('Authorization', `Bearer ${adminToken}`)
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app.getHttpServer()).get(
            `/api/public/media/${id}/content`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/media/${id}/content`)
            .set('Authorization', `Bearer ${farmToken}`)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/media/${id}/content`)
            .set('Authorization', `Bearer ${adminToken}`)
        ).status,
      ).toBe(200);
    });

    it('rejects a product image uploaded by a farm user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/media')
        .set('Authorization', `Bearer ${farmToken}`)
        .field('kind', 'PRODUCT_IMAGE')
        .field('productId', productId)
        .attach('file', png, {
          filename: 'unauthorized.png',
          contentType: 'image/png',
        });
      expect(response.status).toBe(403);
      expect(
        await prisma.mediaAsset.count({
          where: { productId, uploadedById: fixture!.farmId },
        }),
      ).toBe(0);
    });

    it('rejects a file whose declared MIME type does not match its bytes', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('kind', 'PRODUCT_IMAGE')
        .field('productId', productId)
        .attach('file', png, {
          filename: 'fake.jpg',
          contentType: 'image/jpeg',
        });
      expect(response.status).toBe(400);
    });
  },
);
