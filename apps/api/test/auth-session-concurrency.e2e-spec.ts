import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { OrganizationsService } from '../src/modules/organizations/organizations.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { PrismaService as PrismaProvider } from '../src/prisma/prisma.service.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const jwt = new JwtService({ secret: 'auth-concurrency-tests-only-secret' });
const persistence = prisma as unknown as PrismaService;
const auth = new AuthService(persistence, jwt);
const guard = new JwtAuthGuard(jwt, persistence);

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Only scheduling is instrumented. All reads, row locks, writes and commits
// execute on real PostgreSQL connections, including the competing operation.
function pauseSessionInsert() {
  const entered = barrier();
  const resume = barrier();
  const gated = new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction') {
        return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
          prisma.$transaction(
            async (tx) => {
              const sessionDelegate = new Proxy(tx.refreshSession, {
                get(delegate, method) {
                  if (method === 'create')
                    return async (
                      args: Parameters<typeof tx.refreshSession.create>[0],
                    ) => {
                      entered.release();
                      await resume.promise;
                      return tx.refreshSession.create(args);
                    };
                  return Reflect.get(delegate, method);
                },
              });
              return callback(
                new Proxy(tx, {
                  get(transaction, method) {
                    if (method === 'refreshSession') return sessionDelegate;
                    return Reflect.get(transaction, method);
                  },
                }),
              );
            },
            { timeout: 15_000 },
          );
      }
      return Reflect.get(target, key);
    },
  });
  return {
    service: new AuthService(gated as unknown as PrismaService, jwt),
    entered,
    resume,
  };
}

async function waitForBlockedWriter() {
  const deadline = Date.now() + 5_000;
  do {
    const [{ count }] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error(
    'The competing writer did not wait for the session owner lock',
  );
}

function accepts(token: string) {
  return guard.canActivate({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
    }),
  } as ExecutionContext);
}

function applyCookies(jar: Map<string, string>, headers: unknown) {
  const values: unknown[] = Array.isArray(headers)
    ? headers
    : typeof headers === 'string'
      ? [headers]
      : [];
  for (const header of values) {
    if (typeof header !== 'string') continue;
    const [name, value] = header.split(';')[0].split('=');
    if (/Max-Age=0(?:;|$)/i.test(header)) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

describe('PostgreSQL auth session concurrency', { timeout: 20_000 }, () => {
  let userId: string;
  let organizationId: string;
  let email: string;
  const password = 'auth-concurrency-password';

  beforeEach(async () => {
    const role = await prisma.role.upsert({
      where: { code: 'FARM_STAFF' },
      create: { code: 'FARM_STAFF', name: 'Farm staff' },
      update: {},
    });
    const organization = await prisma.organization.create({
      data: { name: `Auth test ${randomUUID()}`, type: 'FARM' },
    });
    organizationId = organization.id;
    email = `auth-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        fullName: 'Auth test',
        passwordHash: await hash(password, 4),
        roleId: role.id,
        organizationId,
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(['logout', 'lock account', 'disable organization'] as const)(
    'keeps old and rotated JWTs revoked after %s races with refresh, including reactivation',
    async (operation) => {
      const original = await auth.login({ email, password });
      const gate = pauseSessionInsert();
      const rotating = gate.service.refresh({
        refreshToken: original.refreshToken,
      });
      await gate.entered.promise;
      const revoking =
        operation === 'logout'
          ? auth.logout({ refreshToken: original.refreshToken })
          : operation === 'lock account'
            ? new UsersService(persistence).updateStatus(userId, {
                accountStatus: 'LOCKED',
              })
            : new OrganizationsService(persistence).update(organizationId, {
                status: 'INACTIVE',
              });
      try {
        await waitForBlockedWriter();
      } finally {
        gate.resume.release();
      }
      const rotated = await rotating;
      await revoking;
      if (operation === 'lock account')
        await new UsersService(persistence).updateStatus(userId, {
          accountStatus: 'ACTIVE',
        });
      if (operation === 'disable organization')
        await new OrganizationsService(persistence).update(organizationId, {
          status: 'ACTIVE',
        });
      expect(
        await prisma.refreshSession.count({
          where: { userId, revokedAt: null },
        }),
      ).toBe(0);
      await expect(accepts(original.accessToken)).rejects.toMatchObject({
        status: 401,
      });
      await expect(accepts(rotated.accessToken)).rejects.toMatchObject({
        status: 401,
      });
      await expect(
        auth.refresh({ refreshToken: rotated.refreshToken }),
      ).rejects.toMatchObject({ status: 401 });
    },
  );

  it.each(['lock account', 'disable organization'] as const)(
    'revokes a login created concurrently with %s',
    async (operation) => {
      const gate = pauseSessionInsert();
      const signingIn = gate.service.login({ email, password });
      await gate.entered.promise;
      const disabling =
        operation === 'lock account'
          ? new UsersService(persistence).updateStatus(userId, {
              accountStatus: 'LOCKED',
            })
          : new OrganizationsService(persistence).update(organizationId, {
              status: 'INACTIVE',
            });
      try {
        await waitForBlockedWriter();
      } finally {
        gate.resume.release();
      }
      const session = await signingIn;
      await disabling;
      await new UsersService(persistence).updateStatus(userId, {
        accountStatus: 'ACTIVE',
      });
      await new OrganizationsService(persistence).update(organizationId, {
        status: 'ACTIVE',
      });
      await expect(accepts(session.accessToken)).rejects.toMatchObject({
        status: 401,
      });
      await expect(
        auth.refresh({ refreshToken: session.refreshToken }),
      ).rejects.toMatchObject({ status: 401 });
    },
  );

  it.each(['lock account', 'disable organization'] as const)(
    'rejects refresh queued behind %s after re-reading the committed state',
    async (operation) => {
      const original = await auth.login({ email, password });
      const entered = barrier();
      const resume = barrier();
      const disabling = prisma.$transaction(
        async (tx) => {
          if (operation === 'lock account')
            await tx.user.update({
              where: { id: userId },
              data: { accountStatus: 'LOCKED' },
            });
          else
            await tx.organization.update({
              where: { id: organizationId },
              data: { status: 'INACTIVE' },
            });
          await tx.refreshSession.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          entered.release();
          await resume.promise;
        },
        { timeout: 15_000 },
      );
      await entered.promise;
      const refreshing = auth.refresh({ refreshToken: original.refreshToken });
      const rejected = expect(refreshing).rejects.toMatchObject({
        status: 401,
      });
      try {
        await waitForBlockedWriter();
      } finally {
        resume.release();
      }
      await disabling;
      await rejected;
      await new UsersService(persistence).updateStatus(userId, {
        accountStatus: 'ACTIVE',
      });
      await new OrganizationsService(persistence).update(organizationId, {
        status: 'ACTIVE',
      });
      await expect(accepts(original.accessToken)).rejects.toMatchObject({
        status: 401,
      });
      expect(
        await prisma.refreshSession.count({
          where: { userId, revokedAt: null },
        }),
      ).toBe(0);
    },
  );

  it('allows one of two concurrent rotations and preserves the winning family', async () => {
    const session = await auth.login({ email, password });
    const results = await Promise.allSettled([
      auth.refresh({ refreshToken: session.refreshToken }),
      auth.refresh({ refreshToken: session.refreshToken }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { status: 409 } });
    expect(
      await prisma.refreshSession.count({
        where: { familyId: session.sessionId, revokedAt: null },
      }),
    ).toBe(1);
    await expect(accepts(session.accessToken)).resolves.toBe(true);
  });

  it('keeps the absolute family expiry in sync with the browser selector', async () => {
    const original = await auth.login({ email, password });
    const rotated = await auth.refresh({ refreshToken: original.refreshToken });
    expect(rotated.refreshExpiresAt).toEqual(original.refreshExpiresAt);
  });

  it('commits replay revocation before returning 401', async () => {
    const original = await auth.login({ email, password });
    const rotated = await auth.refresh({ refreshToken: original.refreshToken });
    await prisma.refreshSession.update({
      where: { id: original.sessionId },
      data: { revokedAt: new Date(Date.now() - 10_000) },
    });
    await expect(
      auth.refresh({ refreshToken: original.refreshToken }),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await prisma.refreshSession.count({
        where: { familyId: original.sessionId, revokedAt: null },
      }),
    ).toBe(0);
    await expect(accepts(rotated.accessToken)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('supports old API inserts without family_id and rotates/revokes legacy sessions', async () => {
    const id = randomUUID();
    const token = randomUUID();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await prisma.$executeRaw`INSERT INTO refresh_session (refresh_session_id, user_id, token_hash, expires_at)
      VALUES (${id}::uuid, ${userId}::uuid, ${tokenHash}, now() + interval '1 day')`;
    expect(
      (await prisma.refreshSession.findUniqueOrThrow({ where: { id } }))
        .familyId,
    ).toBeNull();
    const rotated = await auth.refresh({ refreshToken: token });
    expect(rotated.sessionId).toBe(id);
    await expect(accepts(rotated.accessToken)).resolves.toBe(true);
    await auth.logout({ refreshToken: token });
    await expect(accepts(rotated.accessToken)).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each(['success', 'unauthorized', 'logout'] as const)(
    'keeps browser B selected when a late A %s response arrives',
    async (lateResponse) => {
      let app: INestApplication | undefined;
      const entered = barrier();
      const resume = barrier();
      let delayNext = true;
      const delayedAuth = new Proxy(auth, {
        get(target, method) {
          if (method === 'refresh')
            return async (input: { refreshToken: string }) => {
              const result = await target.refresh(input);
              if (delayNext) {
                delayNext = false;
                entered.release();
                await resume.promise;
                if (lateResponse === 'unauthorized') {
                  const { UnauthorizedException } =
                    await import('@nestjs/common');
                  throw new UnauthorizedException('Old session');
                }
              }
              return result;
            };
          if (method === 'logout' && lateResponse === 'logout')
            return async (input: { refreshToken: string }) => {
              const result = await target.logout(input);
              entered.release();
              await resume.promise;
              return result;
            };
          const value: unknown = Reflect.get(target, method);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      try {
        const fixture = await Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(PrismaProvider)
          .useValue(prisma)
          .overrideProvider(ConfigService)
          .useValue({
            getOrThrow: () => 'auth-concurrency-tests-only-secret',
            get: (_key: string, fallback: unknown) => fallback,
          })
          .overrideProvider(AuthService)
          .useValue(delayedAuth)
          .compile();
        app = fixture.createNestApplication();
        app.setGlobalPrefix('api');
        await app.init();
        const jar = new Map<string, string>();
        const a = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email, password })
          .expect(201);
        applyCookies(jar, a.headers['set-cookie']);
        const aCookies = cookieHeader(jar);
        const late = request(app.getHttpServer())
          .post(`/api/auth/${lateResponse === 'logout' ? 'logout' : 'refresh'}`)
          .set('Cookie', aCookies)
          .send({})
          .then((response) => response);
        await entered.promise;

        const bEmail = `auth-b-${randomUUID()}@example.test`;
        await prisma.user.create({
          data: {
            email: bEmail,
            fullName: 'Account B',
            passwordHash: await hash(password, 4),
            organizationId,
            roleId: (
              await prisma.user.findUniqueOrThrow({ where: { id: userId } })
            ).roleId,
          },
        });
        const b = await request(app.getHttpServer())
          .post('/api/auth/login')
          .set('Cookie', aCookies)
          .send({ email: bEmail, password })
          .expect(201);
        applyCookies(jar, b.headers['set-cookie']);
        resume.release();
        const stale = await late;
        expect(stale.status).toBe(lateResponse === 'unauthorized' ? 401 : 201);
        applyCookies(jar, stale.headers['set-cookie']);
        expect(jar.get('agritrace_session')).toBe(b.body.sessionId);
        const restored = await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('Cookie', cookieHeader(jar))
          .send({})
          .expect(201);
        expect(restored.body.user.email).toBe(bEmail);
        await expect(accepts(a.body.accessToken)).rejects.toMatchObject({
          status: 401,
        });
        await expect(accepts(b.body.accessToken)).resolves.toBe(true);
      } finally {
        resume.release();
        await app?.close();
      }
    },
  );
});
