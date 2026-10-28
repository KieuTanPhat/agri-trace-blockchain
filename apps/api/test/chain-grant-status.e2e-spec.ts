import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { newSessionIds } from './support/session.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
let app: INestApplication;
let adminId: string;
let adminToken: string;
let farmRoleId: string;
let gate: {
  userId: string;
  entered: () => void;
  release: Promise<void>;
} | null = null;

async function recipient() {
  const organization = await prisma.organization.create({
    data: { name: `Grant race ${randomUUID()}`, type: 'FARM' },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      roleId: farmRoleId,
      email: `grant-race-${randomUUID()}@example.test`,
      fullName: 'Grant race recipient',
      passwordHash: 'test-only-unused-password',
    },
  });
  const session = await prisma.refreshSession.create({
    data: { ...newSessionIds(),
      userId: user.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    user,
    organization,
    token: app.get(JwtService).sign({ sub: user.id, sid: session.id }),
  };
}

function grant(target: Awaited<ReturnType<typeof recipient>>) {
  return request(app.getHttpServer())
    .post(`/api/organizations/${target.organization.id}/scoped-grants`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', randomUUID())
    .send({ userId: target.user.id, role: 'ORG_ADMIN' });
}

/** Uses the same UPDATE + session revocation as the status services, with a
 * transaction-local label so the test observes its real PostgreSQL lock wait. */
function disable(
  target: Awaited<ReturnType<typeof recipient>>,
  subject: 'user' | 'organization',
  label: string,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('application_name', ${label}, true)`;
      if (subject === 'user')
        await tx.user.update({
          where: { id: target.user.id },
          data: { accountStatus: 'INACTIVE' },
        });
      else
        await tx.organization.update({
          where: { id: target.organization.id },
          data: { status: 'INACTIVE' },
        });
      await tx.refreshSession.updateMany({
        where: { userId: target.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    { timeout: 10000 },
  );
}

describe('Grant issuance versus recipient disable with real PostgreSQL locks', () => {
  beforeAll(async () => {
    const adminRole = await prisma.role.upsert({
      where: { code: 'SYSTEM_ADMIN' },
      create: { code: 'SYSTEM_ADMIN', name: 'SYSTEM_ADMIN' },
      update: {},
    });
    farmRoleId = (
      await prisma.role.upsert({
        where: { code: 'FARM_STAFF' },
        create: { code: 'FARM_STAFF', name: 'FARM_STAFF' },
        update: {},
      })
    ).id;
    const admin = await prisma.user.create({
      data: {
        roleId: adminRole.id,
        email: `grant-admin-${randomUUID()}@example.test`,
        fullName: 'Grant race platform admin',
        passwordHash: 'test-only-unused-password',
      },
    });
    adminId = admin.id;
    const session = await prisma.refreshSession.create({
      data: { ...newSessionIds(),
        userId: admin.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const gated = prisma.$extends({
      query: {
        scopedRoleGrant: {
          async create({ args, query }) {
            if (gate && args.data.userId === gate.userId) {
              gate.entered();
              await gate.release;
            }
            return query(args);
          },
        },
      },
    });
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(gated)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'grant-race-tests-only-secret',
        get: (_key: string, fallback: unknown) => fallback,
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
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();
    adminToken = app.get(JwtService).sign({ sub: admin.id, sid: session.id });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it.each(['user', 'organization'] as const)(
    'holds %s disable until the grant and command journal commit',
    async (subject) => {
      const target = await recipient();
      let release!: () => void;
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      gate = {
        userId: target.user.id,
        entered,
        release: new Promise<void>((resolve) => {
          release = resolve;
        }),
      };
      const flight = grant(target).then((value) => value);
      const label = `grant-disable-${randomUUID()}`;
      let disabling: Promise<void> | undefined;
      let status: number | undefined;
      try {
        await Promise.race([
          enteredPromise,
          flight.then((value) => {
            throw new Error(`Grant failed before gate: ${value.status}`);
          }),
        ]);
        disabling = disable(target, subject, label);
        let waiting = false;
        for (let attempt = 0; attempt < 40 && !waiting; attempt++) {
          const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE application_name = ${label} AND wait_event_type = 'Lock'
            ) AS blocked`;
          waiting = rows[0].blocked;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(waiting).toBe(true);
        expect(
          (
            await prisma.user.findUniqueOrThrow({
              where: { id: target.user.id },
            })
          ).accountStatus,
        ).toBe('ACTIVE');
        expect(
          (
            await prisma.organization.findUniqueOrThrow({
              where: { id: target.organization.id },
            })
          ).status,
        ).toBe('ACTIVE');
        expect(
          await prisma.scopedRoleGrant.count({
            where: { userId: target.user.id },
          }),
        ).toBe(0);
      } finally {
        release();
        gate = null;
        const [created] = await Promise.all([flight, disabling]);
        status = created.status;
      }
      expect(status).toBe(201);
      const issued = await prisma.scopedRoleGrant.findFirstOrThrow({
        where: { userId: target.user.id },
      });
      expect(
        await prisma.commandCommit.count({
          where: {
            requesterId: adminId,
            operation: 'HYB_GRANT_ROLE',
            resourceIds: { path: ['result', 'id'], equals: issued.id },
          },
        }),
      ).toBe(1);
      await request(app.getHttpServer())
        .get('/api/chain-permissions')
        .set('Authorization', `Bearer ${target.token}`)
        .expect(401);
      await grant(target).expect(403);
      expect(
        await prisma.scopedRoleGrant.count({
          where: { userId: target.user.id },
        }),
      ).toBe(1);
    },
    30000,
  );

  it.each(['user', 'organization'] as const)(
    'rejects issuance when %s disable committed first without a grant or audit',
    async (subject) => {
      const target = await recipient();
      const auditsBefore = await prisma.chainAudit.count({
        where: { actorUserId: adminId, operation: 'GRANT_ROLE' },
      });
      await disable(target, subject, `disable-first-${randomUUID()}`);
      await grant(target).expect(403);
      expect(
        await prisma.scopedRoleGrant.count({
          where: { userId: target.user.id },
        }),
      ).toBe(0);
      expect(
        await prisma.chainAudit.count({
          where: { actorUserId: adminId, operation: 'GRANT_ROLE' },
        }),
      ).toBe(auditsBefore);
      expect(
        await prisma.commandCommit.count({
          where: {
            requesterId: adminId,
            operation: 'HYB_GRANT_ROLE',
            resourceIds: {
              path: ['requested', 'userId'],
              equals: target.user.id,
            },
          },
        }),
      ).toBe(0);
    },
    30000,
  );
});
