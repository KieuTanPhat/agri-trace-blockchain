import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';

const url = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: url ?? 'postgresql://unused@localhost/unused',
  }),
});
(url ? describe : describe.skip)(
  'Enterprise registration and approval on PostgreSQL',
  () => {
    let app: INestApplication, admin: string, jwt: JwtService;
    let throttleBypass: { mockRestore(): void };
    const password = 'demo-enterprise-pass-2026';
    const form = (mode = 'MANAGED_ORG') => ({
      requestId: randomUUID(),
      email: `onboard-${randomUUID()}@example.test`,
      password,
      fullName: 'Người đại diện',
      organizationName: 'Doanh nghiệp demo',
      businessId: 'DEMO-' + randomUUID().slice(0, 12).toUpperCase(),
      organizationType: 'FARM',
      hostingMode: mode,
    });
    const post = (
      path: string,
      body: object,
      token?: string,
      key = randomUUID(),
    ) =>
      request(app.getHttpServer())
        .post('/api' + path)
        .set('Idempotency-Key', key)
        .set('Authorization', token ? `Bearer ${token}` : '')
        .send(body);
    const get = (path: string, token: string) =>
      request(app.getHttpServer())
        .get('/api' + path)
        .set('Authorization', `Bearer ${token}`);
    const register = async (mode = 'MANAGED_ORG') => {
      const input = form(mode);
      await post('/auth/register', input).expect(201);
      const login = await post('/auth/login', {
        email: input.email,
        password,
      }).expect(201);
      const token = login.body.data.accessToken as string;
      const enrollment = (
        await get('/enterprise-enrollments/mine', token).expect(200)
      ).body.data;
      return { input, token, enrollment };
    };
    const approve = (id: string, version = 0, key = randomUUID()) =>
      post(
        `/enterprise-enrollments/${id}/review`,
        { version, decision: 'APPROVE', note: 'Đã đối chiếu hồ sơ demo' },
        admin,
        key,
      );
    beforeAll(async () => {
      process.env.ENTERPRISE_ONBOARDING_ENABLED = 'true';
      throttleBypass = vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
      for (const code of [
        'SYSTEM_ADMIN',
        'FARM_STAFF',
        'TRANSPORTER',
        'RETAILER',
      ])
        await prisma.role.upsert({
          where: { code },
          create: { code, name: code },
          update: {},
        });
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: 'SYSTEM_ADMIN' },
      });
      const user = await prisma.user.create({
        data: {
          roleId: role.id,
          email: `onboard-admin-${randomUUID()}@example.test`,
          passwordHash: 'not-a-login-fixture',
          fullName: 'Admin',
        },
      });
      const sid = randomUUID();
      await prisma.refreshSession.create({
        data: {
          id: sid,
          familyId: sid,
          userId: user.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideGuard(ThrottlerGuard)
        .useValue({ canActivate: () => true })
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
      jwt = app.get(JwtService);
      admin = jwt.sign({ sub: user.id, sid });
    });
    afterAll(async () => {
      throttleBypass?.mockRestore();
      await app?.close();
      await prisma.$disconnect();
    });
    it('atomically registers without granting business access; exact retry returns original receipt', async () => {
      const input = form();
      const [a, b] = await Promise.all([
        post('/auth/register', input),
        post('/auth/register', input),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.data).toEqual(b.body.data);
      const row = await prisma.enterpriseEnrollment.findUniqueOrThrow({
        where: { id: input.requestId },
      });
      expect(
        await prisma.organizationCapability.count({
          where: { organizationId: row.organizationId },
        }),
      ).toBe(0);
      expect(
        await prisma.scopedRoleGrant.count({
          where: { organizationId: row.organizationId },
        }),
      ).toBe(0);
      expect(JSON.stringify(a.body)).not.toMatch(
        /password|Digest|Hash|accessToken/,
      );
      await post('/auth/register', { ...input, fullName: 'Changed' }).expect(
        409,
      );
      const login = await post('/auth/login', {
        email: input.email,
        password,
      }).expect(201);
      await post(
        '/supply-chains',
        { name: 'Cannot create yet' },
        login.body.data.accessToken,
      ).expect(403);
    });
    it('keeps public registration closed when the release flag is disabled', async () => {
      const before = await prisma.enterpriseEnrollment.count();
      process.env.ENTERPRISE_ONBOARDING_ENABLED = 'false';
      try {
        await post('/auth/register', form()).expect(503);
      } finally {
        process.env.ENTERPRISE_ONBOARDING_ENABLED = 'true';
      }
      expect(await prisma.enterpriseEnrollment.count()).toBe(before);
    });
    it('rejects privilege injection and oversized Unicode passwords before any writes', async () => {
      const before = await prisma.enterpriseEnrollment.count();
      for (const patch of [
        { role: 'SYSTEM_ADMIN' },
        { organizationType: 'AUDITOR' },
        { password: '🌾'.repeat(19) },
        { hostingMode: 'SERVICE' },
      ])
        await post('/auth/register', { ...form(), ...patch }).expect(400);
      expect(await prisma.enterpriseEnrollment.count()).toBe(before);
    });
    it('rolls back duplicate email/business ids and isolates owners', async () => {
      const a = await register(),
        b = await register();
      const before = await prisma.organization.count();
      await post('/auth/register', { ...form(), email: a.input.email }).expect(
        409,
      );
      await post('/auth/register', {
        ...form(),
        businessId: a.input.businessId,
      }).expect(409);
      expect(await prisma.organization.count()).toBe(before);
      expect(
        (await get('/enterprise-enrollments/mine', b.token)).body.data.id,
      ).toBe(b.enrollment.id);
      await get('/enterprise-enrollments', a.token).expect(403);
      await post(
        `/enterprise-enrollments/${b.enrollment.id}/review`,
        { version: 0, decision: 'APPROVE', note: 'No' },
        a.token,
      ).expect(403);
    });
    it('serializes approval and journals a decision once; grants organization authority only', async () => {
      const a = await register();
      const key = randomUUID();
      const body = {
        version: 0,
        decision: 'APPROVE',
        note: 'Đã đối chiếu hồ sơ demo',
      };
      const results = await Promise.all([
        approve(a.enrollment.id, 0, key),
        approve(a.enrollment.id, 0),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const row = await prisma.enterpriseEnrollment.findUniqueOrThrow({
        where: { id: a.enrollment.id },
      });
      expect(row.status).toBe('APPROVED');
      expect(
        await prisma.organizationCapability.count({
          where: { organizationId: row.organizationId },
        }),
      ).toBe(1);
      const grants = await prisma.scopedRoleGrant.findMany({
        where: { organizationId: row.organizationId },
      });
      expect(grants.map((g) => g.role).sort()).toEqual([
        'CREATE_CHAIN',
        'ORG_ADMIN',
      ]);
      // Replay whichever command committed; it cannot create another grant.
      if (results[0].status === 201)
        await post(
          `/enterprise-enrollments/${row.id}/review`,
          body,
          admin,
          key,
        ).expect(201);
      expect(
        await prisma.commandCommit.count({
          where: {
            operation: 'ENTERPRISE_REVIEW',
            resourceIds: { path: ['requested', 'id'], equals: row.id },
          },
        }),
      ).toBe(1);
    });
    it('creates a managed connection request with stable retry and rejects foreign chains/config overrides', async () => {
      const a = await register(),
        b = await register();
      await approve(a.enrollment.id).expect(201);
      await approve(b.enrollment.id).expect(201);
      const chain = (
        await post('/supply-chains', { name: 'Owner chain' }, a.token).expect(
          201,
        )
      ).body.data;
      const foreign = (
        await post('/supply-chains', { name: 'Other chain' }, b.token).expect(
          201,
        )
      ).body.data;
      await post(
        '/enterprise-connections',
        { id: randomUUID(), chainId: foreign.id },
        a.token,
      ).expect(404);
      await post(
        '/enterprise-connections',
        { id: randomUUID(), chainId: chain.id, peerHost: '127.0.0.1' },
        a.token,
      ).expect(400);
      const input = { id: randomUUID(), chainId: chain.id },
        key = randomUUID();
      const first = await post(
        '/enterprise-connections',
        input,
        a.token,
        key,
      ).expect(201);
      await post('/enterprise-connections', input, a.token, key).expect(201);
      expect(first.body.data.status).toBe('PENDING_REVIEW');
      await post(
        `/enterprise-connections/${input.id}/review`,
        { version: 0, decision: 'APPROVE', note: 'Sẵn sàng provision' },
        admin,
      ).expect(201);
      const stored = await prisma.enterpriseConnection.findUniqueOrThrow({
        where: { id: input.id },
      });
      expect(stored.status).toBe('APPROVED');
      expect(stored.evidence).toBeNull();
      const grant = await prisma.scopedRoleGrant.findFirstOrThrow({
        where: {
          userId: (
            await prisma.enterpriseEnrollment.findUniqueOrThrow({
              where: { id: a.enrollment.id },
            })
          ).ownerId,
          role: 'ORG_ADMIN',
        },
      });
      await prisma.scopedRoleGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      await post('/enterprise-connections', input, a.token, key).expect(403);
    });
    it('rejects missing self-managed certificates and private key material without network calls', async () => {
      const a = await register('SELF_MANAGED_ORG');
      await approve(a.enrollment.id).expect(201);
      const chain = (
        await post('/supply-chains', { name: 'Self chain' }, a.token).expect(
          201,
        )
      ).body.data;
      for (const patch of [
        {},
        { peerHost: 'http://user:pass@localhost/path', peerPort: 7051 },
        {
          peerHost: 'peer.example.test',
          peerPort: 7051,
          peerServerName: 'peer.example.test',
          mspId: 'Org3MSP',
          tlsCaPem:
            '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
        },
      ])
        await post(
          '/enterprise-connections',
          { id: randomUUID(), chainId: chain.id, ...patch },
          a.token,
        ).expect(400);
      expect(
        await prisma.enterpriseConnection.count({
          where: { chainId: chain.id },
        }),
      ).toBe(0);
    });
    it('rate limits public registration attempts with the actual global guard', async () => {
      throttleBypass.mockRestore();
      try {
        for(let i=0;i<5;i++) await post('/auth/register',{}).expect(400);
        await post('/auth/register',{}).expect(429);
      } finally {
        throttleBypass = vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
      }
    });
  },
);
