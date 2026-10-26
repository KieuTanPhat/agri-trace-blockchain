import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { provisionChain } from './support/chain-scope.js';

// Real PostgreSQL, HTTP, validation, bcrypt and session locks for the staff
// app's native session and QR lookup. Business routes keep their own suites.
describe('Staff app / isolated PostgreSQL', () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const url = new URL(connectionString);
  if (
    !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
    !/(test|_ci)/i.test(url.pathname)
  )
    throw new Error('Owned isolated local test database required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const tag = randomUUID();
  const password = 'staff app password 2026';
  const config = new ConfigService({
    JWT_SECRET: 'staff-isolated-tests-only-secret',
    JWT_EXPIRES_IN: '1h',
    STAFF_APP_AUTH_ENABLED: 'true',
    NODE_ENV: 'test',
    // Session posts must still work while business writes are closed.
    HYBRID_WRITES_MODE: 'CLOSED',
    PASSWORD_MAX_AGE_DAYS: '0',
  });
  const emails: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  let traceToken: string;
  let lotId: string;
  let app: INestApplication;
  let baseline: { events: number; outbox: number };

  const post = (action: string, body: object) =>
    request(app.getHttpServer()).post(`/api/auth/staff/${action}`).send(body);
  const login = (name: string, extra: object = {}) =>
    post('login', { email: emails[name], password, ...extra });

  beforeAll(async () => {
    baseline = {
      events: await db.traceEvent.count(),
      outbox: await db.blockchainOutbox.count(),
    };
    const org = (type: 'FARM' | 'TRANSPORTER') =>
      db.organization.create({ data: { name: `Staff ${tag} ${type}`, type } });
    const farmOrg = await org('FARM');
    const foreignOrg = await org('FARM');
    for (const [name, code, organizationId, loginPhone] of [
      ['farm', 'FARM_STAFF', farmOrg.id, null],
      ['foreign', 'FARM_STAFF', foreignOrg.id, null],
      ['admin', 'SYSTEM_ADMIN', null, null],
      ['consumer', 'CONSUMER', null, `+849${String(Date.now()).slice(-8)}`],
    ] as const) {
      const role = await db.role.findUniqueOrThrow({ where: { code } });
      emails[name] = loginPhone
        ? `${loginPhone.slice(1)}@phone.invalid`
        : `staff-${name}-${tag}@example.test`;
      userIds[name] = (
        await db.user.create({
          data: {
            email: emails[name],
            loginPhone,
            fullName: `Staff ${tag} ${name}`,
            passwordHash: await hash(password, 12),
            roleId: role.id,
            organizationId,
          },
        })
      ).id;
    }
    const chainId = await provisionChain(db, {
      ownerOrganizationId: farmOrg.id,
      memberOrganizationIds: [foreignOrg.id],
      grants: [
        { userId: userIds.farm, organizationId: farmOrg.id, role: 'ORG_ADMIN' },
        { userId: userIds.farm, organizationId: farmOrg.id, role: 'FARM_STAFF' },
        {
          userId: userIds.foreign,
          organizationId: foreignOrg.id,
          role: 'FARM_STAFF',
        },
      ],
    });
    const product = await db.product.create({
      data: { productName: `Staff ${tag} cà chua`, defaultUnit: 'kg' },
    });
    const farm = await db.farm.create({
      data: { organizationId: farmOrg.id, name: `Staff ${tag} farm` },
    });
    const cycle = await db.productionCycle.create({
      data: {
        cycleCode: randomUUID(),
        productId: product.id,
        farmId: farm.id,
        farmOrgId: farmOrg.id,
        chainId,
        currentState: 'PLANTED',
      },
    });
    // Read scope needs the FARM capability and an accepted production stage.
    await db.organizationCapability.createMany({
      data: [farmOrg.id, foreignOrg.id].map((organizationId) => ({
        organizationId,
        code: 'FARM' as const,
      })),
      skipDuplicates: true,
    });
    await db.stageAssignment.create({
      data: {
        chainId,
        organizationId: farmOrg.id,
        stage: 'PRODUCTION',
        cycleId: cycle.id,
        status: 'ACCEPTED',
      },
    });
    const harvest = await db.harvestEvent.create({
      data: { cycleId: cycle.id, harvestTime: new Date(), quantity: 420, unit: 'kg' },
    });
    lotId = (
      await db.lot.create({
        data: {
          lotCode: `STAFF-${randomUUID()}`,
          harvestId: harvest.id,
          productId: product.id,
          farmOrgId: farmOrg.id,
          initialQuantity: 420,
          availableQuantity: 420,
          unit: 'kg',
        },
      })
    ).id;
    traceToken = randomUUID().replaceAll('-', '');
    await db.traceQr.create({
      data: { lotId, traceToken, traceUrl: 'https://example.invalid/trace/x' },
    });

    const fixture = await Test.createTestingModule({ imports: [AppModule] })
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
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    // Only this suite's sessions; trace QR and lot rows are append-only.
    await db.refreshSession.deleteMany({
      where: { userId: { in: Object.values(userIds) } },
    });
    await db.$disconnect();
  });

  it('is closed unless STAFF_APP_AUTH_ENABLED is true', async () => {
    config.set('STAFF_APP_AUTH_ENABLED', 'false');
    try {
      await login('farm').expect(503);
    } finally {
      config.set('STAFF_APP_AUTH_ENABLED', 'true');
    }
  });

  it('signs an enterprise member in natively: token in body, no cookie, no-store', async () => {
    const response = await login('farm').expect(201);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    const session = response.body.data;
    expect(session.tokenType).toBe('Bearer');
    expect(session.refreshToken.length).toBeGreaterThanOrEqual(32);
    expect(session.user.role.code).toBe('FARM_STAFF');
    expect(session.user).not.toHaveProperty('passwordHash');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
  });

  it('refuses platform and consumer accounts exactly like a wrong password', async () => {
    const wrong = await post('login', {
      email: emails.farm,
      password: 'not the password at all',
    }).expect(401);
    for (const name of ['admin', 'consumer']) {
      const refused = await login(name).expect(401);
      expect(refused.body.error?.message ?? refused.body.message).toEqual(
        wrong.body.error?.message ?? wrong.body.message,
      );
    }
    expect(
      await db.refreshSession.count({
        where: { userId: { in: [userIds.admin, userIds.consumer] } },
      }),
    ).toBe(0);
  });

  it('rotates the refresh token and rejects a replayed one', async () => {
    const first = (await login('farm').expect(201)).body.data;
    const second = (
      await post('refresh', { refreshToken: first.refreshToken }).expect(201)
    ).body.data;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.sessionId).toBe(first.sessionId);
    // Outside the concurrent-rotation window a replay revokes the family.
    await db.refreshSession.updateMany({
      where: { familyId: first.sessionId, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    await post('refresh', { refreshToken: first.refreshToken }).expect(401);
    await post('refresh', { refreshToken: second.refreshToken }).expect(401);
  });

  it('logout revokes the family and a new login retires the previous one', async () => {
    const first = (await login('farm').expect(201)).body.data;
    const second = (
      await login('farm', { previousRefreshToken: first.refreshToken }).expect(
        201,
      )
    ).body.data;
    expect(second.sessionId).not.toBe(first.sessionId);
    await post('refresh', { refreshToken: first.refreshToken }).expect(401);
    await post('logout', { refreshToken: second.refreshToken }).expect(201);
    await post('refresh', { refreshToken: second.refreshToken }).expect(401);
  });

  it('resolves a scanned QR to the lot only inside the caller scope', async () => {
    const own = (await login('farm').expect(201)).body.data.accessToken;
    const foreign = (await login('foreign').expect(201)).body.data.accessToken;
    const scan = (token: string, bearer: string) =>
      request(app.getHttpServer())
        .get(`/api/lots/by-trace-token/${token}`)
        .set('Authorization', `Bearer ${bearer}`);
    const found = await scan(traceToken, own).expect(200);
    expect(found.body.data.lotId).toBe(lotId);
    const hidden = await scan(traceToken, foreign).expect(404);
    const unknown = await scan('a'.repeat(32), own).expect(404);
    expect(hidden.body.error).toEqual(unknown.body.error);
    await scan('bad token!', own).expect(400);
    await request(app.getHttpServer())
      .get(`/api/lots/by-trace-token/${traceToken}`)
      .expect(401);
  });

  it('never writes trace events or outbox rows', async () => {
    expect(await db.traceEvent.count()).toBe(baseline.events);
    expect(await db.blockchainOutbox.count()).toBe(baseline.outbox);
  });
});
