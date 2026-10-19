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
import { decryptOtp } from '../src/modules/enterprise-onboarding/registration-otp.service.js';

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
    const form = (mode = 'MANAGED_ORG') => {
      const email = `onboard-${randomUUID()}@example.test`;
      return {
        requestId: randomUUID(),
        email,
        password,
        fullName: 'Người đại diện',
        organizationName: 'Doanh nghiệp demo',
        businessId: Array.from({ length: 10 }, () =>
          Math.floor(Math.random() * 10),
        ).join(''),
        organizationType: 'FARM',
        hostingMode: mode,
        details: {
          legalForm: 'ENTERPRISE',
          address: '123 Đường thử nghiệm',
          province: 'Thành phố Hà Nội',
          provinceCode: '01',
          wardCode: '00004',
          ward: 'Phường Ba Đình',
          phone: '0900000123',
          contactEmail: email,
          representative: 'Người đại diện',
          activities: ['FARM'],
          description: 'Sản xuất nông nghiệp trong kiểm thử cách ly.',
          declarationAccepted: true,
        },
        emailVerifications: [
          { verificationId: randomUUID(), token: 'x'.repeat(43) },
        ],
      };
    };
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
      const input = await verifiedForm(mode);
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
    const verifiedForm = async (mode = 'MANAGED_ORG') => {
      const input = form(mode),
        requestId = randomUUID();
      await post(
        '/auth/registration-otp/request',
        { registrationId: input.requestId, requestId, email: input.email },
        undefined,
        requestId,
      ).expect(201);
      const mail = await prisma.enterpriseMail.findUniqueOrThrow({
        where: { verificationId: requestId },
      });
      const attemptId = randomUUID();
      const verified = await post(
        '/auth/registration-otp/verify',
        {
          registrationId: input.requestId,
          verificationId: requestId,
          attemptId,
          code: decryptOtp(mail.otpCiphertext!),
        },
        undefined,
        attemptId,
      ).expect(201);
      input.emailVerifications = [
        { verificationId: requestId, token: verified.body.data.token },
      ];
      return input;
    };
    const activate = async (a: {
      token: string;
      enrollment: { id: string };
      input: { hostingMode: string };
    }) => {
      const input = {
        planCode: 'TRACE_5',
        hostingMode: a.input.hostingMode,
        billingEmail: 'billing@example.test',
        billingName: 'Đơn vị kiểm thử',
        billingAddress: '123 Địa chỉ kiểm thử',
        catalogVersion: 'agritrace-reference-2026-10-17',
      };
      const preview = (
        await post('/enterprise-service/preview', input, a.token).expect(201)
      ).body.data;
      const order = (
        await post(
          '/enterprise-service/orders',
          { ...input, accepted: true, contractDigest: preview.contractDigest },
          a.token,
        ).expect(201)
      ).body.data;
      const key = randomUUID(),
        payload = {
          version: order.version,
          contractDigest: order.contractDigest,
          method: 'LOCAL_DEMO',
        };
      await post(
        '/enterprise-service/payment-simulation',
        payload,
        a.token,
        key,
      ).expect(201);
      await post(
        '/enterprise-service/payment-simulation',
        payload,
        a.token,
        key,
      ).expect(201);
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
      process.env.ENTERPRISE_PAYMENT_SIMULATION_ENABLED = 'true';
      throttleBypass = vi
        .spyOn(ThrottlerGuard.prototype, 'canActivate')
        .mockResolvedValue(true);
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
      const input = await verifiedForm();
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
    it('requires OTP, binds proof to email and request, consumes once and never exposes the code', async () => {
      const input = form(),
        sendId = randomUUID();
      const issued = await post(
        '/auth/registration-otp/request',
        {
          registrationId: input.requestId,
          requestId: sendId,
          email: input.email,
        },
        undefined,
        sendId,
      ).expect(201);
      expect(JSON.stringify(issued.body)).not.toMatch(
        /codeDigest|otpCiphertext|token|code"/,
      );
      await post('/auth/register', input).expect(400);
      const mail = await prisma.enterpriseMail.findUniqueOrThrow({
          where: { verificationId: sendId },
        }),
        code = decryptOtp(mail.otpCiphertext!);
      const row = await prisma.registrationEmailVerification.findUniqueOrThrow({
        where: { id: sendId },
      });
      expect(row.codeDigest).not.toContain(code);
      expect(mail.text).not.toContain(code);
      const wrongId = randomUUID(),
        wrong = code === '000000' ? '999999' : '000000';
      for (let n = 0; n < 2; n++)
        await post(
          '/auth/registration-otp/verify',
          {
            registrationId: input.requestId,
            verificationId: sendId,
            attemptId: wrongId,
            code: wrong,
          },
          undefined,
          wrongId,
        ).expect(400);
      expect(
        (
          await prisma.registrationEmailVerification.findUniqueOrThrow({
            where: { id: sendId },
          })
        ).attempts,
      ).toBe(1);
      const attemptId = randomUUID(),
        payload = {
          registrationId: input.requestId,
          verificationId: sendId,
          attemptId,
          code,
        };
      const verified = (
        await post(
          '/auth/registration-otp/verify',
          payload,
          undefined,
          attemptId,
        ).expect(201)
      ).body.data;
      expect(
        (
          await post(
            '/auth/registration-otp/verify',
            payload,
            undefined,
            attemptId,
          ).expect(201)
        ).body.data.token,
      ).toBe(verified.token);
      input.emailVerifications = [
        { verificationId: sendId, token: verified.token },
      ];
      await post('/auth/register', {
        ...input,
        requestId: randomUUID(),
      }).expect(400);
      await post('/auth/register', {
        ...input,
        details: {
          ...input.details,
          contactEmail: 'other-' + randomUUID() + '@example.test',
        },
      }).expect(400);
      await post('/auth/register', {
        ...input,
        emailVerifications: [{ verificationId: sendId, token: 'z'.repeat(43) }],
      }).expect(400);
      await post('/auth/register', input).expect(201);
      expect(
        (
          await prisma.registrationEmailVerification.findUniqueOrThrow({
            where: { id: sendId },
          })
        ).consumedAt,
      ).not.toBeNull();
      await post('/auth/register', input).expect(201);
      const newAttempt = randomUUID();
      await post(
        '/auth/registration-otp/verify',
        { ...payload, attemptId: newAttempt },
        undefined,
        newAttempt,
      ).expect(400);
    });
    it('rejects mismatched administrative codes, incomplete profiles and invalid tax identifiers', async () => {
      for (const patch of [
        { businessId: 'INVALID-123' },
        { businessId: '000000000001' },
        { details: undefined },
        {
          details: { ...form().details, provinceCode: '01', wardCode: '99999' },
        },
        { details: { ...form().details, phone: '12345678' } },
        { details: { ...form().details, address: '     ' } },
        { details: { ...form().details, website: 'javascript:alert(1)' } },
      ])
        await post('/auth/register', { ...form(), ...patch }).expect(400);
      const household = await verifiedForm();
      household.details.legalForm = 'HOUSEHOLD_BUSINESS';
      household.businessId = '00' + household.businessId;
      await post('/auth/register', household).expect(201);
    });
    it('locks OTP after five wrong attempts and rejects resend bursts and expired codes', async () => {
      const input = form(),
        requestId = randomUUID();
      await post(
        '/auth/registration-otp/request',
        { registrationId: input.requestId, requestId, email: input.email },
        undefined,
        requestId,
      ).expect(201);
      const second = randomUUID();
      await post(
        '/auth/registration-otp/request',
        {
          registrationId: input.requestId,
          requestId: second,
          email: input.email,
        },
        undefined,
        second,
      ).expect(429);
      const mail = await prisma.enterpriseMail.findUniqueOrThrow({
          where: { verificationId: requestId },
        }),
        correct = decryptOtp(mail.otpCiphertext!),
        wrong = correct === '000000' ? '111111' : '000000';
      for (let n = 0; n < 5; n++) {
        const attemptId = randomUUID();
        await post(
          '/auth/registration-otp/verify',
          {
            registrationId: input.requestId,
            verificationId: requestId,
            attemptId,
            code: wrong,
          },
          undefined,
          attemptId,
        ).expect(400);
      }
      const attemptId = randomUUID();
      await post(
        '/auth/registration-otp/verify',
        {
          registrationId: input.requestId,
          verificationId: requestId,
          attemptId,
          code: correct,
        },
        undefined,
        attemptId,
      ).expect(400);
      const expired = await verifiedForm();
      await prisma.registrationEmailVerification.update({
        where: { id: expired.emailVerifications[0].verificationId },
        data: {
          createdAt: new Date(Date.now() - 700_000),
          expiresAt: new Date(Date.now() - 1),
        },
      });
      await post('/auth/register', expired).expect(400);
    });
    it('serializes approval and grants organization authority only after a settled contract', async () => {
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
      ).toBe(0);
      await post('/supply-chains', { name: 'Not paid' }, a.token).expect(403);
      await post(
        '/enterprise-connections',
        { id: randomUUID(), chainId: randomUUID() },
        a.token,
      ).expect(403);
      await activate(a);
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
      await activate(a);
      await approve(b.enrollment.id).expect(201);
      await activate(b);
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
    it('binds payment to the previewed immutable contract and activates once with one contract email', async () => {
      const a = await register(),
        other = await register();
      const input = {
        planCode: 'TRACE_10',
        hostingMode: 'SELF_MANAGED_ORG',
        billingName: 'Doanh nghiệp thanh toán',
        billingEmail: a.input.email,
        billingAddress: '123 Đường thanh toán',
        catalogVersion: 'agritrace-reference-2026-10-17',
      };
      await post('/enterprise-service/preview', input, a.token).expect(403);
      await approve(a.enrollment.id).expect(201);
      const preview = (
        await post('/enterprise-service/preview', input, a.token).expect(201)
      ).body.data;
      expect(preview.quotation.total).toBe(10_500_000);
      await post(
        '/enterprise-service/orders',
        {
          ...input,
          billingName: 'Tampered',
          accepted: true,
          contractDigest: preview.contractDigest,
        },
        a.token,
      ).expect(409);
      await post(
        '/enterprise-service/orders',
        {
          ...input,
          amount: 1,
          accepted: true,
          contractDigest: preview.contractDigest,
        },
        a.token,
      ).expect(400);
      const order = (
        await post(
          '/enterprise-service/orders',
          { ...input, accepted: true, contractDigest: preview.contractDigest },
          a.token,
        ).expect(201)
      ).body.data;
      await expect(
        prisma.enterpriseServiceOrder.update({
          where: { id: order.id },
          data: { amount: 1 },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.organizationCapability.create({
          data: { organizationId: a.enrollment.organizationId, code: 'FARM' },
        }),
      ).rejects.toThrow();
      const payload = {
        version: 0,
        contractDigest: order.contractDigest,
        method: 'LOCAL_DEMO',
      };
      await post(
        '/enterprise-service/payment-simulation',
        payload,
        other.token,
      ).expect(403);
      await post(
        '/enterprise-service/payment-simulation',
        { ...payload, contractDigest: 'f'.repeat(64) },
        a.token,
      ).expect(409);
      process.env.ENTERPRISE_PAYMENT_SIMULATION_ENABLED = 'false';
      try {
        await post(
          '/enterprise-service/payment-simulation',
          payload,
          a.token,
        ).expect(403);
      } finally {
        process.env.ENTERPRISE_PAYMENT_SIMULATION_ENABLED = 'true';
      }
      const key = randomUUID(),
        results = await Promise.all([
          post('/enterprise-service/payment-simulation', payload, a.token, key),
          post('/enterprise-service/payment-simulation', payload, a.token),
        ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      if (results[0].status === 201)
        await post(
          '/enterprise-service/payment-simulation',
          payload,
          a.token,
          key,
        ).expect(201);
      const access = (await get('/enterprise-access', a.token).expect(200)).body
        .data;
      expect(access.stage).toBe('ACTIVE');
      expect(access.primary).toBe(true);
      const paymentAudit = await prisma.platformAudit.findMany({
        where: { action: 'SERVICE_PAYMENT_SIMULATED', subjectId: order.id },
      });
      expect(paymentAudit).toHaveLength(1);
      expect(paymentAudit[0].organizationId).toBe(a.enrollment.organizationId);
      expect(paymentAudit[0].details).toMatchObject({
        simulated: true,
        status: 'PAID_SIMULATED',
        contractDigest: order.contractDigest,
      });
      expect(
        (await get('/enterprise-enrollments/mine', a.token)).body.data
          .hostingMode,
      ).toBe('SELF_MANAGED_ORG');
      const messages = await prisma.enterpriseMail.findMany({
        where: { enrollmentId: a.enrollment.id },
      });
      expect(messages.map((m) => m.kind).sort()).toEqual([
        'APPROVED',
        'CONTRACT',
      ]);
      expect(messages.find((m) => m.kind === 'CONTRACT')?.attachment).toBe(
        preview.contractText,
      );
      expect(
        await prisma.organizationCapability.count({
          where: { organizationId: a.enrollment.organizationId },
        }),
      ).toBe(1);
    });
    it('rejects missing self-managed certificates and private key material without network calls', async () => {
      const a = await register('SELF_MANAGED_ORG');
      await approve(a.enrollment.id).expect(201);
      await activate(a);
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
    it('lets approved organizations own catalog data and rejects cross-organization writes', async () => {
      const a = await register(),
        b = await register();
      await approve(a.enrollment.id).expect(201);
      await activate(a);
      await approve(b.enrollment.id).expect(201);
      await activate(b);
      const product = (
        await post(
          '/catalog/products',
          { productName: 'Private enterprise product', defaultUnit: 'kg' },
          a.token,
        ).expect(201)
      ).body.data;
      expect(product.organizationId).toBe(a.enrollment.organizationId);
      const adminVisible = (await get('/catalog', admin).expect(200)).body.data
        .products;
      expect(
        adminVisible.some((p: { id: string }) => p.id === product.id),
      ).toBe(true);
      const visible = (await get('/catalog', b.token).expect(200)).body.data
        .products;
      expect(visible.some((p: { id: string }) => p.id === product.id)).toBe(
        false,
      );
      await post(
        '/catalog/farms',
        { organizationId: a.enrollment.organizationId, name: 'Forged farm' },
        b.token,
      ).expect(403);
      await post(
        `/organizations/${a.enrollment.organizationId}/capabilities`,
        { code: 'TRANSPORTER' },
        a.token,
      ).expect(403);
    });
    it('delegates 1→2→3 without escalation and revokes descendants with the delegating manager', async () => {
      const a = await register();
      await approve(a.enrollment.id).expect(201);
      await activate(a);
      await post(
        '/enterprise-workspace/members',
        {
          fullName: 'Invalid password',
          email: randomUUID() + '@example.test',
          password: '🌾'.repeat(19),
          tier: 3,
          roles: [],
        },
        a.token,
      ).expect(400);
      const managerRole = (
        await post(
          '/enterprise-workspace/roles',
          {
            name: 'Delegated manager',
            permissions: [
              'profile.read',
              'members.read',
              'members.manage',
              'roles.manage',
            ],
          },
          a.token,
        ).expect(201)
      ).body.data.record;
      const readerRole = (
        await post(
          '/enterprise-workspace/roles',
          { name: 'Reader', permissions: ['profile.read'] },
          a.token,
        ).expect(201)
      ).body.data.record;
      const managerInput = {
        fullName: 'Manager',
        email: `manager-${randomUUID()}@example.test`,
        password,
        tier: 2,
        roles: [{ roleId: managerRole.id, chainIds: [], siteIds: [] }],
      };
      const manager = (
        await post(
          '/enterprise-workspace/members',
          managerInput,
          a.token,
        ).expect(201)
      ).body.data.record;
      const managerToken = (
        await post('/auth/login', {
          email: managerInput.email,
          password,
        }).expect(201)
      ).body.data.accessToken;
      await post(
        '/enterprise-workspace/roles',
        { name: 'Escalation', permissions: ['qr.manage'] },
        managerToken,
      ).expect(403);
      await post(
        '/enterprise-workspace/members',
        {
          ...managerInput,
          email: `forged-${randomUUID()}@example.test`,
          tier: 2,
        },
        managerToken,
      ).expect(403);
      const childInput = {
        fullName: 'Staff',
        email: `staff-${randomUUID()}@example.test`,
        password,
        tier: 3,
        roles: [{ roleId: readerRole.id, chainIds: [], siteIds: [] }],
      };
      const child = (
        await post(
          '/enterprise-workspace/members',
          childInput,
          managerToken,
        ).expect(201)
      ).body.data.record;
      const childToken = (
        await post('/auth/login', { email: childInput.email, password }).expect(
          201,
        )
      ).body.data.accessToken;
      await post(
        '/enterprise-workspace/members',
        { ...childInput, email: `other-${randomUUID()}@example.test` },
        childToken,
      ).expect(403);
      await post(
        '/catalog/products',
        { productName: 'Unauthorized product' },
        childToken,
      ).expect(403);
      await post(
        `/enterprise-workspace/members/${manager.id}`,
        { version: manager.enterpriseRevision, status: 'LOCKED', roles: [] },
        a.token,
      ).expect(201);
      await get('/enterprise-workspace', childToken).expect(401);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: child.id } }))
          .accountStatus,
      ).toBe('LOCKED');
      expect(
        await prisma.refreshSession.count({
          where: { userId: child.id, revokedAt: null },
        }),
      ).toBe(0);
    });
    it('rate limits public registration attempts with the actual global guard', async () => {
      throttleBypass.mockRestore();
      try {
        for (let i = 0; i < 5; i++)
          await post('/auth/register', {}).expect(400);
        await post('/auth/register', {}).expect(429);
      } finally {
        throttleBypass = vi
          .spyOn(ThrottlerGuard.prototype, 'canActivate')
          .mockResolvedValue(true);
      }
    });
  },
);
