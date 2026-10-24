import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { openSecret, sealSecret } from '../src/common/crypto/secret-box.js';
import {
  generateTotpSecret,
  hotp,
  totpStep,
} from '../src/common/crypto/totp.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { lockPlatformAudit } from '../src/modules/platform-governance/platform-audit.js';
import { rotatePlatformSecrets } from '../src/modules/platform-governance/platform-secret-rotation.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { newSessionIds } from './support/session.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const key = randomBytes(32);
const originalKey = process.env.PLATFORM_SECRET_KEY;
const PASSWORD = 'private-fixture-password-only';
const MESSAGE = 'Yêu cầu riêng tư chỉ hiển thị cho đúng chủ thể dữ liệu';
type Actor = { id: string; token: string; email: string };
let app: INestApplication;
let jwt: JwtService;
let admin: Actor,
  owner: Actor,
  stranger: Actor,
  auditor: Actor,
  operator: Actor,
  cases: Actor,
  privacy: Actor;
let passwordHash: string;
const fixtureUserIds: string[] = [];

async function withRotationDatabase(work: (db: PrismaClient) => Promise<void>) {
  // The operator intentionally rotates every encrypted row. Give that test a
  // database of its own so it cannot touch other suites' MFA/private fixtures.
  const database = `agt_platform_rotation_${randomUUID().replaceAll('-', '')}`;
  if (!/^agt_platform_rotation_[0-9a-f]{32}$/.test(database))
    throw new Error('Invalid owned database');
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  let child: PrismaClient | undefined;
  try {
    url.pathname = `/${database}`;
    const cli = join(
      dirname(createRequire(import.meta.url).resolve('prisma/package.json')),
      'build/index.js',
    );
    try {
      execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          TEST_DATABASE_URL: url.toString(),
        },
        stdio: 'pipe',
      });
    } catch {
      throw new Error('Owned rotation database migration failed');
    }
    child = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString() }),
    });
    await work(child);
  } finally {
    await child?.$disconnect();
    // Only this freshly created, unguessable fixture database is removed.
    await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
}

async function actor(code: string): Promise<Actor> {
  const role = await prisma.role.upsert({
    where: { code },
    create: { code, name: code },
    update: {},
  });
  const user = await prisma.user.create({
    data: {
      email: `privacy-${randomUUID()}@example.test`,
      fullName: 'Private fixture',
      passwordHash,
      roleId: role.id,
    },
  });
  fixtureUserIds.push(user.id);
  const session = await prisma.refreshSession.create({
    data: { ...newSessionIds(),
      userId: user.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return {
    id: user.id,
    email: user.email,
    token: jwt.sign({ sub: user.id, sid: session.id }),
  };
}
function call(
  method: 'get' | 'post',
  who: Actor,
  path: string,
  body?: object,
  idem = randomUUID(),
) {
  const req = request(app.getHttpServer())
    [method](`/api/${path}`)
    .set('Authorization', `Bearer ${who.token}`);
  if (method === 'post') req.set('Idempotency-Key', idem);
  return body ? req.send(body) : req;
}
const createRequest = (who: Actor = owner, idem = randomUUID()) =>
  call(
    'post',
    who,
    'privacy-requests',
    { requestType: 'ACCESS', message: MESSAGE },
    idem,
  );

describe('Private rights, recall drill and narrow platform roles (PostgreSQL)', () => {
  beforeAll(async () => {
    process.env.PLATFORM_SECRET_KEY = key.toString('base64');
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'platform-private-tests-only',
        get: (_name: string, fallback: unknown) => fallback,
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
    jwt = app.get(JwtService);
    passwordHash = await hash(PASSWORD, 4);
    admin = await actor('SYSTEM_ADMIN');
    owner = await actor('FARM_STAFF');
    stranger = await actor('FARM_STAFF');
    auditor = await actor('AUDITOR');
    operator = await actor('PLATFORM_OPERATOR');
    cases = await actor('PLATFORM_CASE_MANAGER');
    privacy = await actor('PLATFORM_PRIVACY_OFFICER');
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await prisma.user.updateMany({
      where: { id: { in: fixtureUserIds } },
      data: { accountStatus: 'INACTIVE' },
    });
    await prisma.$disconnect();
    if (originalKey === undefined) delete process.env.PLATFORM_SECRET_KEY;
    else process.env.PLATFORM_SECRET_KEY = originalKey;
  });

  it('isolates requests by subject, replays creation and keeps plaintext out of journal/audit', async () => {
    const idem = randomUUID();
    const created = await createRequest(owner, idem).expect(201);
    const id = created.body.data.id as string;
    expect((await createRequest(owner, idem).expect(201)).body.data.id).toBe(
      id,
    );
    expect(
      (await call('get', owner, `privacy-requests/${id}`).expect(200)).body.data
        .message,
    ).toBe(MESSAGE);
    await call('get', stranger, `privacy-requests/${id}`).expect(404);
    await call('get', admin, `privacy-requests/${id}`).expect(404);
    expect(
      (await call('get', privacy, `platform-privacy/${id}`).expect(200)).body
        .data.message,
    ).toBe(MESSAGE);
    const stored = await prisma.platformPrivacyTicket.findUniqueOrThrow({
      where: { id },
    });
    expect(stored.payloadCiphertext).not.toContain(MESSAGE);
    expect(
      openSecret(stored.payloadCiphertext, `platform-privacy:${id}`, key),
    ).toBe(MESSAGE);
    const journals = await prisma.commandCommit.findMany({
      where: { requesterId: owner.id },
    });
    const audits = await prisma.platformAudit.findMany({
      where: { subjectId: id },
    });
    expect(audits[0].actorUserId).toBeNull();
    expect(audits[0].actorRole).toBe('SYSTEM');
    expect(audits[0].details).not.toHaveProperty('requestType');
    expect(
      JSON.stringify([journals, audits], (_name, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toContain(MESSAGE);
    expect(created.body.data.message).toBeUndefined();
    expect(
      await prisma.platformPrivacyTicket.count({
        where: { requesterId: owner.id },
      }),
    ).toBe(1);
  });

  it('shares only deliberate responses and rejects stale changes or closed history edits', async () => {
    const id = (await createRequest().expect(201)).body.data.id as string;
    const internal = 'Ghi chú nội bộ không được hiển thị cho người yêu cầu';
    await call('post', privacy, `platform-privacy/${id}/review`, {
      version: 0,
      status: 'IN_REVIEW',
      note: internal,
    }).expect(201);
    expect(
      (await call('get', owner, `privacy-requests/${id}`).expect(200)).body.data
        .events,
    ).toEqual([]);
    await call('post', privacy, `platform-privacy/${id}/review`, {
      version: 0,
      status: 'CLOSED',
      note: 'Stale update must not work',
    }).expect(409);
    await call('post', privacy, `platform-privacy/${id}/review`, {
      version: 1,
      status: 'RESPONDED',
      note: 'Phản hồi được chia sẻ đúng chủ thể',
      visibility: 'SHARED',
    }).expect(201);
    const detail = (
      await call('get', owner, `privacy-requests/${id}`).expect(200)
    ).body.data;
    expect(detail.events).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain(internal);
    await call('post', privacy, `platform-privacy/${id}/review`, {
      version: 2,
      status: 'CLOSED',
      note: 'Đã hoàn tất xem xét theo hồ sơ',
      visibility: 'SHARED',
    }).expect(201);
    await call('post', privacy, `platform-privacy/${id}/review`, {
      version: 3,
      status: 'IN_REVIEW',
      note: 'Không được mở lại hồ sơ đã đóng',
    }).expect(409);
    await expect(
      prisma.$executeRaw`DELETE FROM platform_privacy_event WHERE ticket_id = ${id}::uuid`,
    ).rejects.toThrow();
  });

  it('pins the 72-hour clock to discovery and requires reporting assessment before closure', async () => {
    const detectedAt = new Date(Date.now() - 74 * 3_600_000).toISOString();
    const created = (
      await call('post', privacy, 'platform-privacy/breaches', {
        detectedAt,
        message: MESSAGE,
      }).expect(201)
    ).body.data;
    expect(
      new Date(created.deadlineAt).getTime() - new Date(detectedAt).getTime(),
    ).toBe(72 * 3_600_000);
    expect(created.overdue).toBe(true);
    await call('post', privacy, `platform-privacy/${created.id}/review`, {
      version: 0,
      status: 'CLOSED',
      note: 'Chưa đánh giá nghĩa vụ báo cáo',
    }).expect(422);
    await expect(
      prisma.$executeRaw`UPDATE platform_privacy_ticket SET detected_at = now(), deadline_at = now() + interval '72 hours' WHERE id = ${created.id}::uuid`,
    ).rejects.toThrow();
    const updated = await call(
      'post',
      privacy,
      `platform-privacy/${created.id}/review`,
      {
        version: 0,
        status: 'CLOSED',
        reporting: 'REQUIRED',
        reportedAt: new Date().toISOString(),
        notificationReference: 'private-report-reference',
        note: 'Đã thông báo và giữ bằng chứng bên ngoài',
      },
    ).expect(201);
    expect(updated.body.data.overdue).toBe(false);
    expect(JSON.stringify(updated.body)).not.toContain(
      'private-report-reference',
    );
    await call('post', privacy, 'platform-privacy/breaches', {
      detectedAt: new Date(Date.now() + 3_600_000).toISOString(),
      message: MESSAGE,
    }).expect(422);
    await call('post', owner, 'platform-privacy/breaches', {
      detectedAt,
      message: MESSAGE,
    }).expect(403);
  });

  it('does not grant platform specialists unrelated administration or business writes', async () => {
    for (const who of [operator, cases, privacy]) {
      await call('get', who, 'users').expect(403);
      await call('post', who, 'platform-approvals', {}).expect(403);
      await call('post', who, `lots/${randomUUID()}/recall`, {
        version: 0,
        reason: 'Không được ghi nghiệp vụ',
      }).expect(403);
    }
    await call('get', operator, 'platform-operations/summary').expect(200);
    await call('get', operator, 'platform-operations/admin-summary').expect(
      403,
    );
    await call('get', cases, 'platform-cases').expect(200);
    await call('get', cases, 'platform-cases/organization-options').expect(200);
    await call('post', cases, 'platform-cases', {
      title: 'Điều phối sự cố',
      description: 'Thông tin hồ sơ để doanh nghiệp xử lý',
      category: 'QUALITY',
      severity: 'LOW',
      source: 'INTERNAL',
    }).expect(201);
    for (const who of [auditor, operator, cases])
      await call('get', who, 'platform-privacy').expect(403);
    await call('get', privacy, 'platform-privacy').expect(200);
    await call('get', privacy, 'platform-cases').expect(403);
    for (const who of [operator, cases, privacy])
      await call('get', who, 'auth/mfa').expect(200);
  });

  it('previews source distribution without changing stock, lot state, notices or outbox', async () => {
    const org = await prisma.organization.create({
      data: { type: 'FARM', name: 'Recall fixture organization' },
    });
    const carrier = await prisma.organization.create({
      data: { type: 'TRANSPORTER', name: 'Recall carrier' },
    });
    const receiver = await prisma.organization.create({
      data: { type: 'RETAILER', name: 'Recall receiver' },
    });
    const lotId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.lot.create({
        data: {
          id: lotId,
          lotCode: `RECALL-${lotId}`,
          harvestId: randomUUID(),
          productId: randomUUID(),
          farmOrgId: org.id,
          initialQuantity: 100,
          availableQuantity: 100,
          unit: 'kg',
        },
      });
      await tx.lotHolding.create({
        data: { lotId, organizationId: org.id, quantity: 60, reserved: 10 },
      });
      for (const status of ['DELIVERED', 'CANCELLED'])
        await tx.distributionTransfer.create({
          data: {
            chainId: randomUUID(),
            senderId: org.id,
            carrierId: carrier.id,
            receiverId: receiver.id,
            origin: 'private-origin-address',
            destination: 'private-destination-address',
            status,
            lines: { create: { lotId, quantity: 40, unit: 'kg' } },
          },
        });
    });
    const before = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    const outboxBefore = await prisma.blockchainOutbox.count();
    const preview = (
      await call('get', operator, `platform-recall/${lotId}`).expect(200)
    ).body.data;
    expect(preview.readOnly).toBe(true);
    expect(preview.lots).toHaveLength(1);
    expect(preview.movements).toHaveLength(1);
    expect(preview.holdings[0].reserved).toBe('10.000');
    expect(preview.movements[0].status).toBe('DELIVERED');
    expect(JSON.stringify(preview)).not.toContain('private-origin-address');
    expect(
      await prisma.lot.findUniqueOrThrow({ where: { id: lotId } }),
    ).toEqual(before);
    expect(await prisma.blockchainOutbox.count()).toBe(outboxBefore);
    expect(await prisma.traceNotice.count({ where: { lotId } })).toBe(0);
    await call('get', owner, `platform-recall/${lotId}`).expect(403);
    await call('get', operator, 'platform-recall/not-a-uuid').expect(400);
  });

  it('rejects session issuance when a concurrent platform lock commits after password lookup', async () => {
    const target = await actor('SYSTEM_ADMIN');
    let outcome: Promise<string> | undefined;
    await prisma.$transaction(
      async (tx) => {
        await lockPlatformAudit(tx);
        outcome = app
          .get(AuthService)
          .login({ email: target.email, password: PASSWORD })
          .then(
            () => 'ISSUED',
            () => 'DENIED',
          );
        let queued = false;
        for (let i = 0; i < 100; i++) {
          const rows = await tx.$queryRaw<
            { waiting: bigint }[]
          >`SELECT count(*) AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
          if (rows[0].waiting > 0n) {
            queued = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        expect(queued).toBe(true);
        await tx.user.update({
          where: { id: target.id },
          data: { lockedUntil: new Date(Date.now() + 60_000) },
        });
      },
      { timeout: 10_000 },
    );
    expect(await outcome).toBe('DENIED');
    expect(
      await prisma.refreshSession.count({ where: { userId: target.id } }),
    ).toBe(1);
  });

  it('keeps a specialist MFA failure and retry on the same idempotency key', async () => {
    const officer = await actor('PLATFORM_PRIVACY_OFFICER');
    const seed = generateTotpSecret();
    await prisma.platformMfa.create({
      data: {
        userId: officer.id,
        status: 'ENABLED',
        enabledAt: new Date(),
        secretCiphertext: sealSecret(seed, `platform-mfa:${officer.id}`, key),
      },
    });
    const body = { detectedAt: new Date().toISOString(), message: MESSAGE };
    const idem = randomUUID();
    await call('post', officer, 'platform-privacy/breaches', body, idem).expect(
      403,
    );
    await call('post', officer, 'platform-privacy/breaches', body, idem)
      .set('X-MFA-Code', hotp(seed, totpStep()))
      .expect(201);
    expect(
      await prisma.platformPrivacyTicket.count({
        where: { createdBy: officer.id },
      }),
    ).toBe(1);
  });

  it('counts concurrent rejected logins once per attempt and locks a platform reviewer without issuing sessions', async () => {
    const previousMax = process.env.PLATFORM_LOGIN_MAX_ATTEMPTS;
    process.env.PLATFORM_LOGIN_MAX_ATTEMPTS = '3';
    try {
      const target = await actor('COMPLIANCE_REVIEWER');
      const org = await prisma.organization.create({
        data: { type: 'AUDITOR', name: 'Concurrent reviewer fixture' },
      });
      await prisma.user.update({
        where: { id: target.id },
        data: { organizationId: org.id },
      });
      const outcomes = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          app
            .get(AuthService)
            .login({ email: target.email, password: 'wrong-fixture-password' }),
        ),
      );
      expect(outcomes.every((item) => item.status === 'rejected')).toBe(true);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(stored.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(stored.failedLoginCount).toBe(0);
      expect(
        await prisma.platformAudit.count({
          where: { action: 'USER_LOGIN_LOCKED', subjectId: target.id },
        }),
      ).toBe(1);
      await expect(
        app.get(AuthService).login({ email: target.email, password: PASSWORD }),
      ).rejects.toThrow();
      expect(
        await prisma.refreshSession.count({ where: { userId: target.id } }),
      ).toBe(1);
    } finally {
      if (previousMax === undefined)
        delete process.env.PLATFORM_LOGIN_MAX_ATTEMPTS;
      else process.env.PLATFORM_LOGIN_MAX_ATTEMPTS = previousMax;
    }
  });

  it('regenerates one-time recovery codes while REQUIRED keeps the factor enabled', async () => {
    const previousMode = process.env.PLATFORM_MFA_MODE;
    process.env.PLATFORM_MFA_MODE = 'REQUIRED';
    try {
      const officer = await actor('PLATFORM_PRIVACY_OFFICER');
      const seed = generateTotpSecret();
      await prisma.platformMfa.create({
        data: {
          userId: officer.id,
          status: 'ENABLED',
          enabledAt: new Date(),
          secretCiphertext: sealSecret(seed, `platform-mfa:${officer.id}`, key),
        },
      });
      const code = hotp(seed, totpStep());
      const result = await call('post', officer, 'auth/mfa/recovery-codes', {
        code,
      }).expect(201);
      expect(result.body.data.recoveryCodes).toHaveLength(10);
      const stored = await prisma.platformMfa.findUniqueOrThrow({
        where: { userId: officer.id },
      });
      expect(stored.status).toBe('ENABLED');
      expect(stored.recoveryCodeHashes).toHaveLength(10);
      expect(
        openSecret(stored.secretCiphertext, `platform-mfa:${officer.id}`, key),
      ).toBe(seed);
      for (const value of result.body.data.recoveryCodes)
        expect(JSON.stringify(stored.recoveryCodeHashes)).not.toContain(value);
      await call('post', officer, 'auth/mfa/recovery-codes', { code }).expect(
        403,
      );
    } finally {
      if (previousMode === undefined) delete process.env.PLATFORM_MFA_MODE;
      else process.env.PLATFORM_MFA_MODE = previousMode;
    }
  });

  it('rotates private ciphertext atomically, preserves closed metadata and explicitly invalidates recovery hashes', async () => {
    await withRotationDatabase(async (prisma) => {
      const newKey = randomBytes(32);
      const role = await prisma.role.upsert({
        where: { code: 'SYSTEM_ADMIN' },
        create: { code: 'SYSTEM_ADMIN', name: 'Rotation fixture' },
        update: {},
      });
      const seedUser = await prisma.user.create({
        data: {
          email: 'rotation@example.test',
          fullName: 'Rotation fixture',
          passwordHash,
          roleId: role.id,
        },
      });
      const ticketId = randomUUID();
      await prisma.platformPrivacyTicket.create({
        data: {
          id: ticketId,
          kind: 'REQUEST',
          requestType: 'ACCESS',
          requesterId: seedUser.id,
          createdBy: seedUser.id,
          status: 'CLOSED',
          payloadCiphertext: sealSecret(
            MESSAGE,
            `platform-privacy:${ticketId}`,
            key,
          ),
        },
      });
      const eventId = randomUUID();
      await prisma.platformPrivacyEvent.create({
        data: {
          id: eventId,
          ticketId,
          actorId: seedUser.id,
          action: 'CLOSED',
          visibility: 'SHARED',
          payloadCiphertext: sealSecret(
            JSON.stringify({ note: MESSAGE }),
            `platform-privacy-event:${eventId}`,
            key,
          ),
        },
      });
      await prisma.platformMfa.create({
        data: {
          userId: seedUser.id,
          secretCiphertext: sealSecret(
            'MFA-FIXTURE-SEED',
            `platform-mfa:${seedUser.id}`,
            key,
          ),
          status: 'PENDING',
          recoveryCodeHashes: ['old-key-hmac'],
        },
      });
      const before = await prisma.platformPrivacyTicket.findMany({
        orderBy: { id: 'asc' },
      });
      const expectedMessages = before.map((row) =>
        openSecret(row.payloadCiphertext, `platform-privacy:${row.id}`, key),
      );
      const dry = await prisma.$transaction((tx) =>
        rotatePlatformSecrets(tx, key, newKey),
      );
      expect(dry.applied).toBe(false);
      expect(
        await prisma.platformPrivacyTicket.findMany({ orderBy: { id: 'asc' } }),
      ).toEqual(before);
      await expect(
        prisma.$transaction((tx) =>
          rotatePlatformSecrets(tx, randomBytes(32), newKey, true),
        ),
      ).rejects.toThrow();
      expect(
        await prisma.platformPrivacyTicket.findMany({ orderBy: { id: 'asc' } }),
      ).toEqual(before);
      const applied = await prisma.$transaction((tx) =>
        rotatePlatformSecrets(tx, key, newKey, true),
      );
      expect(applied.recoveryCodesInvalidated).toBe(1);
      const after = await prisma.platformPrivacyTicket.findMany({
        orderBy: { id: 'asc' },
      });
      expect(
        after.map((row) =>
          openSecret(
            row.payloadCiphertext,
            `platform-privacy:${row.id}`,
            newKey,
          ),
        ),
      ).toEqual(expectedMessages);
      expect(
        after.map(({ payloadCiphertext: _ciphertext, ...row }) => row),
      ).toEqual(
        before.map(({ payloadCiphertext: _ciphertext, ...row }) => row),
      );
      expect(
        (
          await prisma.platformMfa.findUniqueOrThrow({
            where: { userId: seedUser.id },
          })
        ).recoveryCodeHashes,
      ).toEqual([]);
      await prisma.$transaction((tx) =>
        rotatePlatformSecrets(tx, newKey, key, true),
      );
    });
  });
});
