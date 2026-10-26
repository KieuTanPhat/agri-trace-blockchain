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
import type { RegisterDto } from '../src/modules/auth/dto/register.dto.js';
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
    const productForm = (originFarmId: string) => ({
      productName: 'Private enterprise product',
      defaultUnit: 'kg',
      category: 'Rau củ',
      originFarmId,
      storageConditions: 'Bảo quản nơi thoáng mát',
      ingredients: 'Rau tươi',
      usageInstructions: 'Rửa sạch trước khi sử dụng',
    });
    const form = (
      mode: RegisterDto['hostingMode'] = 'MANAGED_ORG',
    ): RegisterDto => {
      const email = `onboard-${randomUUID()}@example.test`;
      return {
        requestId: randomUUID(),
        email,
        fullName: 'Người đại diện',
        organizationName: 'Doanh nghiệp demo',
        businessId: Array.from({ length: 10 }, () =>
          Math.floor(Math.random() * 10),
        ).join(''),
        organizationType: 'FARM',
        hostingMode: mode,
        details: {
          formVersion: 2,
          legalForm: 'ENTERPRISE',
          registrationNumber: 'REG-001',
          address: '123 Đường thử nghiệm',
          province: 'Thành phố Hà Nội',
          provinceCode: '01',
          wardCode: '00004',
          ward: 'Phường Ba Đình',
          phone: '0900000123',
          contactEmail: email,
          representative: 'Người đại diện',
          representativeTitle: 'Giám đốc',
          registrantRelationship: 'REPRESENTATIVE',
          activities: ['FARM'],
          production: {
            sector: 'CROP',
            productGroups: ['Rau'],
            certifications: [],
          },
          services: {
            interests: ['TRACEABILITY'],
            expectedProducts: 'UP_TO_10',
            partnerIntent: 'LATER',
          },
          documentIds: [],
          description: 'Sản xuất nông nghiệp trong kiểm thử cách ly.',
          declarationAccepted: true,
          termsAccepted: true,
          privacyAcknowledged: true,
          marketingAccepted: false,
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
    const uploadRegistrationDocument = async (
      input: RegisterDto,
      verificationId: string,
      token: string,
    ) => {
      const documentId = randomUUID();
      await request(app.getHttpServer())
        .post('/api/auth/registration-documents')
        .field('id', documentId)
        .field('registrationId', input.requestId)
        .field('verificationId', verificationId)
        .field('token', token)
        .field('kind', 'LEGAL_REGISTRATION')
        .attach(
          'file',
          Buffer.from('%PDF-1.4\n% registration fixture\n%%EOF\n'),
          { filename: 'registration.pdf', contentType: 'application/pdf' },
        )
        .expect(201);
      input.details.documentIds = [documentId];
    };
    /** Signs in with the mailed temporary password and replaces it, as an owner does. */
    const claim = async (email: string) => {
      const mail = await prisma.enterpriseMail.findFirstOrThrow({
        where: {
          recipient: email,
          kind: { in: ['CREDENTIALS', 'ACCOUNT_CREDENTIALS'] },
        },
      });
      const temporary = decryptOtp(mail.otpCiphertext!);
      const first = await post('/auth/login', {
        email,
        password: temporary,
      }).expect(201);
      expect(first.body.data.user.mustChangePassword).toBe(true);
      await post(
        '/auth/change-password',
        { currentPassword: temporary, newPassword: password },
        first.body.data.accessToken,
      ).expect(201);
      return post('/auth/login', { email, password }).expect(201);
    };
    const register = async (
      mode: RegisterDto['hostingMode'] = 'MANAGED_ORG',
    ) => {
      const input = await verifiedForm(mode);
      await post('/auth/register', input).expect(201);
      const login = await claim(input.email);
      const token = login.body.data.accessToken as string;
      const enrollment = (
        await get('/enterprise-enrollments/mine', token).expect(200)
      ).body.data;
      return { input, token, enrollment };
    };
    const verifiedForm = async (
      mode: RegisterDto['hostingMode'] = 'MANAGED_ORG',
    ) => {
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
      await uploadRegistrationDocument(
        input,
        requestId,
        verified.body.data.token,
      );
      return input;
    };
    const activateService = async (a: {
      token: string;
      enrollment: { id: string };
    }) => {
      // Activation requires every registered capability to be reviewed by a
      // platform administrator first; the owner cannot review its own.
      const pending = (
        await get('/enterprise-enrollments/mine', a.token).expect(200)
      ).body.data.capabilityRequests.filter(
        (r: { status: string }) => r.status === 'PENDING',
      ) as Array<{ id: string; version: number }>;
      for (const r of pending) {
        const review = {
          version: r.version,
          decision: 'APPROVE',
          note: 'Đã đối chiếu năng lực trong kiểm thử cách ly',
        };
        await post(
          `/capability-requests/${r.id}/review`,
          review,
          a.token,
        ).expect(403);
        await post(`/capability-requests/${r.id}/review`, review, admin).expect(
          201,
        );
      }
      const current = (
        await get('/enterprise-enrollments/mine', a.token).expect(200)
      ).body.data;
      const payload = {
        version: current.version,
        reason: 'Kích hoạt dịch vụ trong kiểm thử cách ly',
      };
      const key = randomUUID();
      await post(
        `/enterprise-enrollments/${a.enrollment.id}/activate`,
        payload,
        a.token,
      ).expect(403);
      const first = await post(
        `/enterprise-enrollments/${a.enrollment.id}/activate`,
        payload,
        admin,
        key,
      ).expect(201);
      const replay = await post(
        `/enterprise-enrollments/${a.enrollment.id}/activate`,
        payload,
        admin,
        key,
      ).expect(201);
      expect(replay.body.data).toEqual(first.body.data);
      await post(
        `/enterprise-enrollments/${a.enrollment.id}/activate`,
        payload,
        admin,
      ).expect(409);
    };
    // The quotation names the digest of the published plan versions the
    // organization sees, exactly as the service page reads it.
    const serviceCatalog = async (token: string) =>
      (await get('/enterprise-service', token).expect(200)).body.data
        .catalog as {
        version: string;
        plans: Array<{
          code: string;
          version: { setupFee: number; annualFee: number };
        }>;
      };
    const catalogVersion = async (token: string) =>
      (await serviceCatalog(token)).version;
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
        catalogVersion: await catalogVersion(a.token),
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
      await activateService(a);
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
      const login = await claim(input.email);
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
    it('rejects privilege injection and client-chosen passwords before any writes', async () => {
      const before = await prisma.enterpriseEnrollment.count();
      for (const patch of [
        { role: 'SYSTEM_ADMIN' },
        { organizationType: 'AUDITOR' },
        { password: 'client-chosen-pass-2026' },
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
      await uploadRegistrationDocument(input, sendId, verified.token);
      await post('/auth/register', {
        ...input,
        requestId: randomUUID(),
      }).expect(400);
      const existing = await register();
      await post('/auth/register', {
        ...input,
        details: {
          ...input.details,
          contactEmail: existing.input.email.toUpperCase(),
        },
      }).expect(409);
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
    it('keeps contact emails unique across accounts and enterprise contacts and mails a temporary password', async () => {
      const contact = `contact-${randomUUID()}@example.test`;
      const first = await verifiedForm();
      first.details.contactEmail = contact;
      await post('/auth/register', first).expect(201);
      const mail = await prisma.enterpriseMail.findFirstOrThrow({
        where: { recipient: first.email, kind: 'CREDENTIALS' },
      });
      expect(mail.enrollmentId).toBe(first.requestId);
      expect(mail.text).not.toContain(decryptOtp(mail.otpCiphertext!));
      expect(
        (await prisma.user.findFirstOrThrow({ where: { email: first.email } }))
          .mustChangePassword,
      ).toBe(true);
      for (const email of [contact, contact.toUpperCase(), first.email])
        expect(
          (
            await post('/auth/registration-email-availability', {
              email,
            }).expect(200)
          ).body.data.available,
        ).toBe(false);
      const second = await verifiedForm();
      second.details.contactEmail = contact.toUpperCase();
      await post('/auth/register', second).expect(409);
      second.details.contactEmail = `other-${randomUUID()}@example.test`;
      await post('/auth/register', second).expect(201);
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
    it('serializes approval and grants organization authority through separate platform activation', async () => {
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
        where: { organizationId: row.organizationId, scope: 'ORGANIZATION' },
      });
      expect(grants.map((g) => g.role).sort()).toEqual([
        'CREATE_CHAIN',
        'ORG_ADMIN',
      ]);
      // Activation also opens the producer's personal chain, ready for cycles
      // once its ledger binding is active; it stays outside the plan limit.
      const chains = await prisma.supplyChain.findMany({
        where: { ownerOrganizationId: row.organizationId },
        include: { businessProfile: true, memberships: true, grants: true },
      });
      expect(chains).toHaveLength(1);
      expect(chains[0]).toMatchObject({
        personal: true,
        businessProfile: { state: 'ACTIVE' },
        memberships: [{ organizationId: row.organizationId, status: 'ACTIVE' }],
      });
      expect(chains[0].grants.map((g) => g.role)).toEqual(
        expect.arrayContaining(['CHAIN_MANAGER', 'FARM_STAFF']),
      );
      expect(new Set(chains[0].grants.map((g) => g.userId))).toEqual(
        new Set([row.ownerId]),
      );
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
    it('binds simulated payment to the contract without granting access, then activates once', async () => {
      const a = await register(),
        other = await register();
      const input = {
        planCode: 'TRACE_10',
        hostingMode: 'SELF_MANAGED_ORG',
        billingName: 'Doanh nghiệp thanh toán',
        billingEmail: a.input.email,
        billingAddress: '123 Đường thanh toán',
        catalogVersion: '',
      };
      await post('/enterprise-service/preview', input, a.token).expect(403);
      await approve(a.enrollment.id).expect(201);
      // A stale catalog version is rejected instead of being re-priced.
      await post(
        '/enterprise-service/preview',
        { ...input, catalogVersion: 'agritrace-reference-2026-10-17' },
        a.token,
      ).expect(400);
      const catalog = await serviceCatalog(a.token);
      input.catalogVersion = catalog.version;
      const preview = (
        await post('/enterprise-service/preview', input, a.token).expect(201)
      ).body.data;
      // Priced from the currently published TRACE_10 version, which an
      // administrator may have re-priced since the 10.5M seed.
      const plan = catalog.plans.find((p) => p.code === 'TRACE_10')!;
      expect(preview.quotation.total).toBe(
        plan.version.setupFee + plan.version.annualFee,
      );
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
      const awaiting = (await get('/enterprise-access', a.token).expect(200))
        .body.data;
      expect(awaiting.stage).toBe('AWAITING_ACTIVATION');
      expect(awaiting.permissions).toEqual([]);
      expect(awaiting.capabilities).toEqual([]);
      expect(
        await prisma.scopedRoleGrant.count({
          where: { organizationId: a.enrollment.organizationId },
        }),
      ).toBe(0);
      await post(
        '/supply-chains',
        { name: 'Paid but not activated' },
        a.token,
      ).expect(403);
      await activateService(a);
      const access = (await get('/enterprise-access', a.token).expect(200)).body
        .data;
      expect(access.stage).toBe('ACTIVE');
      expect(access.primary).toBe(true);
      expect(
        await prisma.platformAudit.count({
          where: {
            action: 'ENTERPRISE_SERVICE_ACTIVATED',
            subjectId: a.enrollment.id,
          },
        }),
      ).toBe(1);
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
      // CREDENTIALS carries the temporary password mailed at registration.
      expect(messages.map((m) => m.kind).sort()).toEqual([
        'APPROVED',
        'CONTRACT',
        'CREDENTIALS',
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
      const farmInput = {
        organizationId: a.enrollment.organizationId,
        name: 'Private enterprise farm',
        kind: 'CROP',
        region: 'Hà Nội',
        address: '123 Địa chỉ vùng sản xuất',
        areaM2: 100,
        expectedOutput: 10,
        outputUnit: 'kg',
        privacy: 'PRIVATE',
      };
      const farm = (
        await post('/catalog/farms', farmInput, a.token).expect(201)
      ).body.data;
      const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp3sAAAAASUVORK5CYII=',
        'base64',
      );
      await post('/catalog/products', productForm(farm.id), a.token).expect(
        422,
      );
      for (const kind of ['LAND_CERTIFICATE'])
        await request(app.getHttpServer())
          .post('/api/enterprise-workspace/evidence')
          .set('Authorization', `Bearer ${a.token}`)
          .set('Idempotency-Key', randomUUID())
          .field('entityType', 'FARM')
          .field('entityId', farm.id)
          .field('kind', kind)
          .field('description', 'Chứng cứ vùng sản xuất trong kiểm thử cách ly')
          .attach('file', image, {
            filename: `${kind}.png`,
            contentType: 'image/png',
          })
          .expect(201);
      await post(
        `/catalog/farms/${farm.id}/complete`,
        { version: 0 },
        a.token,
      ).expect(201);
      const product = (
        await post('/catalog/products', productForm(farm.id), a.token).expect(
          201,
        )
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
        { ...farmInput, name: 'Forged farm' },
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
          jobTitle: 'Nhân viên kiểm thử',
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
        jobTitle: 'Quản lý kiểm thử',
        email: `manager-${randomUUID()}@example.test`,
        phone: '0901234567',
        contactAddress: '12 Nguyễn Huệ, Quận 1',
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
      const managerToken = (await claim(managerInput.email)).body.data
        .accessToken;
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
        jobTitle: 'Nhân viên kiểm thử',
        email: `staff-${randomUUID()}@example.test`,
        phone: '0901234568',
        contactAddress: '12 Nguyễn Huệ, Quận 1',
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
      const childToken = (await claim(childInput.email)).body.data.accessToken;
      await post(
        '/enterprise-workspace/members',
        { ...childInput, email: `other-${randomUUID()}@example.test` },
        childToken,
      ).expect(403);
      await post(
        '/catalog/products',
        productForm(randomUUID()),
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
    it('edits a role already assigned to members and applies it to every holder at once', async () => {
      const a = await register();
      await approve(a.enrollment.id).expect(201);
      await activate(a);
      const role = (
        await post(
          '/enterprise-workspace/roles',
          { name: 'Kho', permissions: ['profile.read'] },
          a.token,
        ).expect(201)
      ).body.data.record;
      const input = {
        fullName: 'Nhân viên kho',
        jobTitle: 'Thủ kho',
        email: `holder-${randomUUID()}@example.test`,
        phone: '0901234569',
        contactAddress: '12 Nguyễn Huệ, Quận 1',
        tier: 3,
      };
      await post(
        '/enterprise-workspace/members',
        { ...input, roles: [] },
        a.token,
      ).expect(400);
      const holder = (
        await post(
          '/enterprise-workspace/members',
          { ...input, roles: [{ roleId: role.id, chainIds: [], siteIds: [] }] },
          a.token,
        ).expect(201)
      ).body.data.record;
      const holderToken = (await claim(input.email)).body.data.accessToken;
      await get('/enterprise-workspace/sites', holderToken).expect(403);
      const edited = (
        await post(
          `/enterprise-workspace/roles/${role.id}`,
          {
            name: 'Kho và cơ sở',
            permissions: ['profile.read', 'sites.read'],
            version: role.version,
          },
          a.token,
        ).expect(201)
      ).body.data;
      expect(edited.affectedMembers).toBe(1);
      expect(edited.record.permissions).toContain('sites.read');
      // Same session, new permission: no sign-in needed.
      await get('/enterprise-workspace/sites', holderToken).expect(200);
      expect(
        await prisma.refreshSession.count({
          where: { userId: holder.id, revokedAt: null },
        }),
      ).toBeGreaterThan(0);
    });
    it('activates with one photo and preserves the last current photo on an active product', async () => {
      const a = await register();
      await approve(a.enrollment.id).expect(201);
      await activate(a);
      const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp3sAAAAASUVORK5CYII=',
        'base64',
      );
      const upload = async (entityType: string, entityId: string, kind: string) =>
        (
          await request(app.getHttpServer())
            .post('/api/enterprise-workspace/evidence')
            .set('Authorization', `Bearer ${a.token}`)
            .set('Idempotency-Key', randomUUID())
            .field('entityType', entityType)
            .field('entityId', entityId)
            .field('kind', kind)
            .field('description', 'Ảnh kiểm thử trên DB cách ly')
            .attach('file', image, { filename: `${kind}.png`, contentType: 'image/png' })
            .expect(201)
        ).body.data.record;
      const farm = (
        await post(
          '/catalog/farms',
          {
            organizationId: a.enrollment.organizationId,
            name: 'Vùng ảnh sản phẩm',
            kind: 'CROP',
            region: 'Hà Nội',
            address: '123 Địa chỉ vùng sản xuất',
            areaM2: 100,
            expectedOutput: 10,
            outputUnit: 'kg',
            privacy: 'PRIVATE',
          },
          a.token,
        ).expect(201)
      ).body.data;
      const farmPhotos = [];
      for (const kind of ['LAND_CERTIFICATE'])
        farmPhotos.push(await upload('FARM', farm.id, kind));
      await post(`/catalog/farms/${farm.id}/complete`, { version: 0 }, a.token).expect(201);
      const product = (
        await post('/catalog/products', productForm(farm.id), a.token).expect(201)
      ).body.data;
      const photos = [];
      await post(`/catalog/products/${product.id}/complete`, { version: product.version }, a.token).expect(409);
      photos.push(await upload('PRODUCT', product.id, 'PRODUCT_IMAGE'));
      await post(`/catalog/products/${product.id}/complete`, { version: product.version }, a.token).expect(201);
      const withdraw = (id: string) =>
        post(`/enterprise-workspace/evidence/${id}/withdraw`, { reason: 'Ảnh mờ, không đúng sản phẩm' }, a.token);
      await withdraw(photos[0].id).expect(409);
      photos.push(await upload('PRODUCT', product.id, 'PRODUCT_IMAGE'));
      await withdraw(photos[0].id).expect(201);
      await withdraw(photos[0].id).expect(409);
      await withdraw(photos[1].id).expect(409);
      await withdraw(farmPhotos[0].id).expect(409);
      const listed = (
        await get(`/enterprise-workspace/evidence?entityType=PRODUCT&entityId=${product.id}`, a.token).expect(200)
      ).body.data.items.map((row: { id: string }) => row.id);
      expect(listed).not.toContain(photos[0].id);
      expect(listed).toHaveLength(1);
      // The file itself stays for audit.
      expect(await prisma.traceEvidence.count({ where: { entityId: product.id } })).toBe(2);
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
