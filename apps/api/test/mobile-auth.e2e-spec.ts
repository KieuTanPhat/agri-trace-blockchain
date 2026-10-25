import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FirebasePhoneVerifier } from '../src/modules/auth/firebase-phone-verifier.js';
import { DEV_CONSUMER_CONSENT } from '../src/modules/auth/mobile-auth.service.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { createOpenApiDocument } from '../src/common/api/openapi.js';
import locations from '../src/common/locations/vietnam.json' with { type: 'json' };

// Real PostgreSQL, HTTP, validation, session locks and bcrypt. Only Firebase
// network verification is a fixture; cryptographic verification is tested separately.
describe('Mobile consumer auth / isolated PostgreSQL', () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const url = new URL(connectionString);
  if (
    !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
    !/(test|_ci)/i.test(url.pathname)
  )
    throw new Error('Owned isolated local test database required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const tag = randomUUID();
  const config = new ConfigService({
    JWT_SECRET: 'mobile-isolated-tests-only-secret',
    JWT_EXPIRES_IN: '1h',
    CONSUMER_AUTH_ENABLED: 'true',
    CONSUMER_DEV_REGISTRATION_ENABLED: 'true',
    NODE_ENV: 'test',
    HYBRID_WRITES_MODE: 'CLOSED',
    RATE_LIMIT_REQUESTS: '20000',
  });
  let app: INestApplication;
  let counter = 0;
  const phones = new Set<string>();
  const proofs = new Map<
    string,
    { phone: string; tokenHash: string; proofKey: string; expiresAt: Date }
  >();
  const password = ' test-password-exact ';
  let baseline: { events: number; outbox: number };
  const phone = () => {
    const value = `+849${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    phones.add(value);
    return value;
  };
  function proof(value: string, key?: string) {
    const token = `${tag}-${++counter}`.padEnd(120, 'x');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    proofs.set(token, {
      phone: value,
      tokenHash,
      proofKey: key ?? tokenHash,
      expiresAt: new Date(Date.now() + 60000),
    });
    return token;
  }
  const post = (action: string, body: object) =>
    request(app.getHttpServer()).post(`/api/auth/mobile/${action}`).send(body);
  const registerBody = (value: string) => ({
    phone: value,
    password,
    fullName: `Fixture ${tag}`,
    provinceCode: locations.provinces[0].code,
    wardCode: locations.provinces[0].wards[0].code,
    consentVersion: DEV_CONSUMER_CONSENT,
    firebaseIdToken: proof(value),
  });
  beforeAll(async () => {
    baseline = {
      events: await db.traceEvent.count(),
      outbox: await db.blockchainOutbox.count(),
    };
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      // This suite exercises DB auth invariants, not the separate per-IP guard.
      // Avoid unrelated tests consuming each other's IP budget; phone limits stay real.
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(FirebasePhoneVerifier)
      .useValue({
        async verify(token: string, value: string) {
          const item = proofs.get(token);
          if (!item || item.phone !== value) {
            const { UnauthorizedException } = await import('@nestjs/common');
            throw new UnauthorizedException('Xác minh không hợp lệ');
          }
          const { phone: _phone, ...data } = item;
          return data;
        },
      })
      .compile();
    app = fixture.createNestApplication();
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
    if (app) await app.close();
    // Only exact fixture users, never reset/truncate shared tables.
    await db.user.deleteMany({
      where: { phone: { in: [...phones] }, fullName: `Fixture ${tag}` },
    });
    await db.user.deleteMany({ where: { email: `${tag}@fixture.invalid` } });
    await db.$disconnect();
  });
  it('registers atomically, stores consent/location and hashes, preserves password bytes and never touches trace/outbox', async () => {
    const value = phone();
    const body = registerBody(value);
    const response = await post('register', body).expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(response.body.data.user).sort()).toEqual([
      'fullName',
      'id',
      'phone',
      'province',
      'ward',
    ]);
    const user = await db.user.findFirstOrThrow({
      where: { phone: value },
      include: { consumerProfile: true },
    });
    expect(user.email).toBe(`${value.slice(1)}@phone.invalid`);
    expect(user.passwordHash).not.toBe(password);
    expect(user.organizationId).toBeNull();
    expect(user.consumerProfile?.consentVersion).toBe(DEV_CONSUMER_CONSENT);
    await post('register', body).expect(409);
    await post('login', { phone: value.replace('+84', '0'), password }).expect(
      201,
    );
    await post('login', { phone: value, password: password.trim() }).expect(
      401,
    );
    expect(await db.traceEvent.count()).toBe(baseline.events);
    expect(await db.blockchainOutbox.count()).toBe(baseline.outbox);
  });
  it('rolls back all registration writes when session creation fails', async () => {
    const value = phone();
    const body = registerBody(value);
    const jwt = app.get(JwtService);
    const original = jwt.sign;
    jwt.sign = () => {
      throw new Error('fixture-session-failure');
    };
    try {
      await post('register', body).expect(500);
    } finally {
      jwt.sign = original;
    }
    expect(await db.user.findFirst({ where: { phone: value } })).toBeNull();
    expect(
      await db.consumerPhoneProof.findUnique({
        where: { tokenHash: proofs.get(body.firebaseIdToken)!.tokenHash },
      }),
    ).toBeNull();
    await post('register', body).expect(201);
  });
  it('allows only one concurrent registration for the same phone', async () => {
    const value = phone();
    const body = registerBody(value);
    const results = await Promise.all([
      post('register', body),
      post('register', body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.user.count({ where: { phone: value } })).toBe(1);
    const account = await db.user.findFirstOrThrow({
      where: { phone: value },
    });
    expect(
      await db.consumerProfile.count({ where: { userId: account.id } }),
    ).toBe(1);
  });
  it('validates fresh proof, location, consent and UTF-8 passwords before writes', async () => {
    const value = phone();
    const body = registerBody(value);
    await post('register', { ...body, firebaseIdToken: proof(phone()) }).expect(
      401,
    );
    await post('register', { ...body, consentVersion: 'not-approved' }).expect(
      422,
    );
    await post('register', { ...body, wardCode: 'not-a-code' }).expect(400);
    await post('register', { ...body, password: 'ậ'.repeat(25) }).expect(400);
    expect(await db.user.findFirst({ where: { phone: value } })).toBeNull();
  });
  it('requires SMS reset for an expired consumer password and restores access after the reset', async () => {
    const value = phone();
    const initial = (await post('register', registerBody(value)).expect(201))
      .body.data;
    await db.user.update({
      where: { id: initial.user.id },
      data: {
        passwordChangedAt: new Date('2000-01-01T00:00:00Z'),
        mustChangePassword: true,
      },
    });
    const before = await db.refreshSession.count({
      where: { userId: initial.user.id },
    });
    await post('refresh', { refreshToken: initial.refreshToken }).expect(401);
    await post('login', { phone: value, password }).expect(401);
    expect(
      await db.refreshSession.count({ where: { userId: initial.user.id } }),
    ).toBe(before);
    const newPassword = 'changed-after-sms-proof';
    await post('password-reset', {
      phone: value,
      newPassword,
      firebaseIdToken: proof(value),
    }).expect(201);
    const updated = await db.user.findUniqueOrThrow({
      where: { id: initial.user.id },
    });
    expect(updated.mustChangePassword).toBe(false);
    expect(updated.passwordChangedAt!.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    const current = (
      await post('login', { phone: value, password: newPassword }).expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .get('/api/consumer/me')
      .set('Authorization', `Bearer ${current.accessToken}`)
      .expect(200);
    await post('refresh', { refreshToken: initial.refreshToken }).expect(401);
  });
  it('reset revokes all old families/JWTs, changes password, consumes proof and returns no new session', async () => {
    const value = phone();
    const a = (await post('register', registerBody(value)).expect(201)).body
      .data;
    const b = (await post('login', { phone: value, password }).expect(201)).body
      .data;
    const body = {
      phone: value,
      newPassword: 'new-password-exact',
      firebaseIdToken: proof(value),
    };
    const result = await post('password-reset', body).expect(201);
    expect(result.body.data).toEqual({ reset: true });
    await post('refresh', { refreshToken: a.refreshToken }).expect(401);
    await post('refresh', { refreshToken: b.refreshToken }).expect(401);
    await request(app.getHttpServer())
      .get('/api/consumer/me')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(401);
    await post('password-reset', body).expect(409);
    await post('login', { phone: value, password }).expect(401);
    await post('login', { phone: value, password: body.newPassword }).expect(
      201,
    );
  });
  it('rotation has one winner, 409/Retry-After for loser; logout with old credential revokes the entire family', async () => {
    const value = phone();
    const initial = (await post('register', registerBody(value)).expect(201))
      .body.data;
    const results = await Promise.all([
      post('refresh', { refreshToken: initial.refreshToken }),
      post('refresh', { refreshToken: initial.refreshToken }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.headers['retry-after']).toBe(
      '1',
    );
    const winner = results.find((r) => r.status === 201)!.body.data;
    await post('logout', { refreshToken: initial.refreshToken }).expect(201);
    await post('logout', { refreshToken: initial.refreshToken }).expect(201);
    await post('refresh', { refreshToken: winner.refreshToken }).expect(401);
  });
  it('consumer token is rejected by every bearer-protected business route in current Swagger, without domain writes', async () => {
    const value = phone();
    const session = (await post('register', registerBody(value)).expect(201))
      .body.data;
    await request(app.getHttpServer())
      .get('/api/consumer/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    const document = createOpenApiDocument(app);
    let checked = 0;
    for (const [path, item] of Object.entries(document.paths)) {
      if (
        path === '/api' ||
        path.startsWith('/api/public/') ||
        path.startsWith('/api/health') ||
        path.startsWith('/api/auth/') ||
        path === '/api/consumer/me'
      )
        continue;
      for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
        const operation = item[method];
        if (!operation?.security?.some((scheme) => 'bearer' in scheme))
          continue;
        const route = path.replace(/\{[^}]+\}/g, randomUUID());
        const response = await request(app.getHttpServer())
          [method](route)
          .set('Authorization', `Bearer ${session.accessToken}`)
          .send({});
        expect([401, 403], `${method} ${path}`).toContain(response.status);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
    expect(await db.traceEvent.count()).toBe(baseline.events);
    expect(await db.blockchainOutbox.count()).toBe(baseline.outbox);
  });
  it('keeps Web login/cookie contract unchanged and refuses enterprise sessions on native routes', async () => {
    const consumer = phone();
    const role = await db.role.findUniqueOrThrow({
      where: { code: 'SYSTEM_ADMIN' },
    });
    await db.user.create({
      data: {
        email: `${tag}@fixture.invalid`,
        phone: consumer,
        fullName: `Fixture ${tag}`,
        passwordHash: await hash(password, 12),
        roleId: role.id,
      },
    });
    const web = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `${tag}@fixture.invalid`, password })
      .expect(201);
    expect(web.body.data.refreshToken).toBeUndefined();
    expect(String(web.headers['set-cookie'])).toContain('HttpOnly');
    await post('register', registerBody(consumer)).expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `${consumer.slice(1)}@phone.invalid`, password })
      .expect(401);
    const session = await db.refreshSession.findFirstOrThrow({
      where: { user: { email: `${tag}@fixture.invalid` } },
    });
    const token = app
      .get(JwtService)
      .sign({ sub: session.userId, sid: session.familyId });
    await request(app.getHttpServer())
      .get('/api/consumer/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
  it('fails closed on disabled feature/production consent and rejects untrusted origins without cookies', async () => {
    const value = phone();
    config.set('CONSUMER_AUTH_ENABLED', 'false');
    const disabled = await post('register', registerBody(value)).expect(503);
    expect(disabled.headers['cache-control']).toBe('no-store');
    config.set('CONSUMER_AUTH_ENABLED', 'true');
    config.set('NODE_ENV', 'production');
    await post('register', registerBody(value)).expect(503);
    config.set('NODE_ENV', 'test');
    await post('login', { phone: value, password })
      .set('Origin', 'https://attacker.invalid')
      .expect(403);
    expect(await db.user.findFirst({ where: { phone: value } })).toBeNull();
  });
  it('enforces a persistent per-phone limit and Retry-After without storing raw phone identifiers', async () => {
    const value = phone();
    for (let i = 0; i < 10; i++)
      await post('login', { phone: value, password }).expect(401);
    const result = await post('login', { phone: value, password }).expect(429);
    expect(result.headers['retry-after']).toBe('900');
    expect(JSON.stringify(await db.consumerAuthLimit.findMany())).not.toContain(
      value,
    );
  });
});
