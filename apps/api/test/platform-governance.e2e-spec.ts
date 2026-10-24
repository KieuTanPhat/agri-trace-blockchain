import {
  ArgumentsHost,
  HttpException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { newSessionIds } from './support/session.js';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { decryptOtp } from '../src/modules/enterprise-onboarding/registration-otp.service.js';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { hotp, totpStep } from '../src/common/crypto/totp.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { verifyPlatformAuditChain } from '../src/modules/platform-governance/platform-audit.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

process.env.PLATFORM_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PLATFORM_LOGIN_MAX_ATTEMPTS = '3';
process.env.PLATFORM_LOGIN_LOCK_MINUTES = '30';
delete process.env.PLATFORM_APPROVALS_MODE;
delete process.env.PLATFORM_MFA_MODE;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const PASSWORD = 'Correct-Horse-Battery-1';
const REASON = 'Kiểm thử quản trị nền tảng bằng PostgreSQL thật';
let app: INestApplication;
let jwt: JwtService;
const passwordHash = hash(PASSWORD, 4);

interface Actor {
  id: string;
  email: string;
  orgId: string | null;
  token: string;
}

async function role(code: string) {
  return prisma.role.upsert({
    where: { code },
    create: { code, name: code },
    update: {},
  });
}
async function makeUser(
  code: string,
  orgType: 'FARM' | 'AUDITOR' | null = null,
): Promise<Actor> {
  const org = orgType
    ? await prisma.organization.create({
        data: { name: `Gov test ${randomUUID()}`, type: orgType },
      })
    : null;
  const user = await prisma.user.create({
    data: {
      fullName: `${code} ${randomUUID().slice(0, 6)}`,
      email: `gov-${randomUUID()}@example.test`,
      organizationId: org?.id,
      roleId: (await role(code)).id,
      passwordHash: await passwordHash,
    },
  });
  return { id: user.id, email: user.email, orgId: org?.id ?? null, token: '' };
}
async function session(actor: Actor) {
  const created = await prisma.refreshSession.create({
    data: { ...newSessionIds(),
      userId: actor.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return jwt.sign({ sub: actor.id, sid: created.id });
}
async function bearer(code: string, orgType: 'FARM' | 'AUDITOR' | null = null) {
  const actor = await makeUser(code, orgType);
  actor.token = await session(actor);
  return actor;
}

const fakeIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const call =
  (method: 'get' | 'post' | 'patch') =>
  (
    actor: Pick<Actor, 'token'>,
    path: string,
    body?: object,
    key: string | null = randomUUID(),
    extra: Record<string, string> = {},
  ) => {
    // Each request gets its own forwarded address so the per-IP throttles
    // (login, MFA, audit scans) do not couple unrelated tests.
    let req = request(app.getHttpServer())
      [method](`/api/${path}`)
      .set('X-Forwarded-For', fakeIp())
      .set('Authorization', `Bearer ${actor.token}`);
    if (method !== 'get' && key) req = req.set('Idempotency-Key', key);
    for (const [name, value] of Object.entries(extra))
      req = req.set(name, value);
    return body ? req.send(body) : req;
  };
const get = call('get');
const post = call('post');
const patch = call('patch');

const plain = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
const auditRows = (where: object = {}) =>
  prisma.platformAudit.findMany({ where, orderBy: { sequence: 'asc' } });
const auditCount = () => prisma.platformAudit.count();

function login(email: string, extra: object = {}, password = PASSWORD) {
  return request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Forwarded-For', fakeIp())
    .send({ email, password, ...extra });
}
/** A TOTP code for the current step; the replay guard is reset so a test can
 * request a fresh code without waiting 30 seconds. */
async function freshCode(userId: string, secret: string) {
  await prisma.platformMfa.update({
    where: { userId },
    data: { lastUsedStep: BigInt(totpStep() - 10) },
  });
  return hotp(secret, totpStep());
}

describe('Platform governance (real PostgreSQL)', () => {
  let admin: Actor;
  let admin2: Actor;
  let auditor: Actor;
  let farm: Actor;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'platform-governance-tests-only-secret',
        get: (_key: string, fallback: unknown) => fallback,
      })
      .compile();
    app = fixture.createNestApplication();
    // The per-IP login throttle is orthogonal to the per-account lockout under
    // test; every supertest request shares one address, so give each login its
    // own forwarded client address instead of weakening the production guard.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    class DiagnosticFilter extends GlobalExceptionFilter {
      override catch(error: unknown, host: ArgumentsHost) {
        if (!(error instanceof HttpException) && error instanceof Error)
          console.error(error.name, error.message.split('\n').at(-1));
        super.catch(error, host);
      }
    }
    app.useGlobalFilters(new DiagnosticFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();
    jwt = app.get(JwtService);
    admin = await bearer('SYSTEM_ADMIN');
    admin2 = await bearer('SYSTEM_ADMIN');
    auditor = await bearer('AUDITOR', 'AUDITOR');
    farm = await bearer('FARM_STAFF', 'FARM');
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  describe('P0-1 append-only audit log', () => {
    it('writes the audit entry in the same transaction as a status change', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      const key = randomUUID();
      const before = await auditCount();
      const response = await patch(
        admin,
        `users/${target.id}/status`,
        { accountStatus: 'LOCKED', version: 0, reason: REASON },
        key,
      ).expect(200);
      expect(response.body.data.version).toBe(1);
      const entries = await auditRows({ subjectId: target.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: 'USER_STATUS_CHANGED',
        actorUserId: admin.id,
        actorRole: 'SYSTEM_ADMIN',
        reason: REASON,
        idempotencyKey: key,
        outcome: 'SUCCESS',
        details: { from: 'ACTIVE', to: 'LOCKED' },
      });
      expect(entries[0].requestId).toBeTruthy();
      expect(await auditCount()).toBe(before + 1);
    });

    it('rejects a missing/short reason and a missing Idempotency-Key without writing', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      const before = await auditCount();
      await patch(admin, `users/${target.id}/status`, {
        accountStatus: 'LOCKED',
        version: 0,
        reason: 'ngắn',
      }).expect(400);
      await patch(admin, `users/${target.id}/status`, {
        accountStatus: 'LOCKED',
        version: 0,
      }).expect(400);
      await patch(
        admin,
        `users/${target.id}/status`,
        { accountStatus: 'LOCKED', version: 0, reason: REASON },
        null,
      ).expect(409); // existing contract: "Thiếu header Idempotency-Key"
      expect(await auditCount()).toBe(before);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
          .accountStatus,
      ).toBe('ACTIVE');
    });

    it('replays the same idempotency key once and rejects a changed payload', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      const key = randomUUID();
      const body = { accountStatus: 'INACTIVE', version: 0, reason: REASON };
      const first = await patch(admin, `users/${target.id}/status`, body, key);
      const replay = await patch(admin, `users/${target.id}/status`, body, key);
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replay.body.data).toEqual(first.body.data);
      expect(await auditRows({ subjectId: target.id })).toHaveLength(1);
      await patch(
        admin,
        `users/${target.id}/status`,
        { ...body, reason: `${REASON} (khác)` },
        key,
      ).expect(409);
    });

    it('does not leave an audit entry when the write is rejected (stale version)', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      await patch(admin, `users/${target.id}/status`, {
        accountStatus: 'LOCKED',
        version: 0,
        reason: REASON,
      }).expect(200);
      const before = await auditCount();
      await patch(admin, `users/${target.id}/status`, {
        accountStatus: 'ACTIVE',
        version: 0,
        reason: REASON,
      }).expect(409);
      expect(await auditCount()).toBe(before);
    });

    it('lets SYSTEM_ADMIN and AUDITOR read the log but nobody else', async () => {
      const page = await get(admin, 'platform-audit?limit=5').expect(200);
      expect(page.body.data.items.length).toBeGreaterThan(0);
      await get(auditor, 'platform-audit?limit=5').expect(200);
      await get(farm, 'platform-audit').expect(403);
      // The auditor cannot write anything on the platform surfaces.
      await patch(auditor, `users/${admin.id}/status`, {
        accountStatus: 'LOCKED',
        version: 0,
        reason: REASON,
      }).expect(403);
      await post(auditor, 'platform-approvals', {
        operation: 'CAPABILITY_GRANT',
        params: {},
        reason: REASON,
      }).expect(403);
    });

    it('filters and paginates with an opaque cursor', async () => {
      const first = await get(admin, 'platform-audit?limit=2').expect(200);
      expect(first.body.data.items).toHaveLength(2);
      expect(first.body.data.nextCursor).toBeTruthy();
      const second = await get(
        admin,
        `platform-audit?limit=2&cursor=${first.body.data.nextCursor}`,
      ).expect(200);
      expect(BigInt(second.body.data.items[0].sequence)).toBeLessThan(
        BigInt(first.body.data.items[1].sequence),
      );
      const filtered = await get(
        admin,
        `platform-audit?action=USER_STATUS_CHANGED&actorUserId=${admin.id}&limit=200`,
      ).expect(200);
      expect(
        filtered.body.data.items.every(
          (item: { action: string }) => item.action === 'USER_STATUS_CHANGED',
        ),
      ).toBe(true);
      await get(admin, 'platform-audit?cursor=not-a-cursor').expect(422);
      await get(admin, 'platform-audit?from=not-a-date').expect(422);
    });

    it('exports a bounded CSV and neutralizes spreadsheet formulas', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      await patch(admin, `users/${target.id}/status`, {
        accountStatus: 'LOCKED',
        version: 0,
        reason: '=HYPERLINK("http://evil.example","x") kiểm thử',
      }).expect(200);
      const exported = await get(
        admin,
        `platform-audit/export?subjectId=${target.id}`,
      ).expect(200);
      expect(exported.body.data.rowCount).toBe(1);
      expect(exported.body.data.truncated).toBe(false);
      expect(exported.body.data.csv).toContain(`'=HYPERLINK`);
      expect(exported.body.data.csv).not.toMatch(/,=HYPERLINK/u);
    });

    it('blocks UPDATE, DELETE and TRUNCATE in the database', async () => {
      await expect(
        prisma.$executeRaw`UPDATE platform_audit SET reason = 'x'`,
      ).rejects.toThrow(/append-only/u);
      await expect(
        prisma.$executeRaw`DELETE FROM platform_audit`,
      ).rejects.toThrow(/append-only/u);
      await expect(
        prisma.$executeRawUnsafe('TRUNCATE platform_audit'),
      ).rejects.toThrow(/append-only/u);
    });

    it('enforces the gap-free hash chain in the database', async () => {
      const head = await prisma.platformAudit.findFirstOrThrow({
        orderBy: { sequence: 'desc' },
      });
      const forged = (sequence: bigint, prevHash: string) =>
        prisma.platformAudit.create({
          data: {
            sequence,
            occurredAt: new Date(),
            actorRole: 'SYSTEM',
            action: 'FORGED',
            subjectType: 'TEST',
            subjectId: 'x',
            prevHash,
            entryHash: randomUUID().replace(/-/gu, '').repeat(2),
          },
        });
      await expect(
        forged(head.sequence + 2n, head.entryHash),
      ).rejects.toThrow();
      await expect(
        forged(head.sequence + 1n, '0'.repeat(64)),
      ).rejects.toThrow();
    });

    it('verifies an intact chain and detects tampering', async () => {
      const intact = await get(admin, 'platform-audit/verify').expect(200);
      expect(intact.body.data.ok).toBe(true);
      expect(intact.body.data.checked).toBeGreaterThanOrEqual(3);
      const victim = await prisma.platformAudit.findFirstOrThrow({
        where: { reason: { not: null } },
        orderBy: { sequence: 'asc' },
      });
      // Only an owner who disables the guard can alter history; the chain
      // verification still exposes it, and the trigger is restored after.
      await prisma.$executeRawUnsafe(
        'ALTER TABLE platform_audit DISABLE TRIGGER trg_platform_audit_no_update_delete',
      );
      try {
        await prisma.$executeRaw`UPDATE platform_audit SET reason = ${'đã bị sửa'} WHERE platform_audit_id = ${victim.id}::uuid`;
        const tampered = await get(admin, 'platform-audit/verify').expect(200);
        expect(tampered.body.data.ok).toBe(false);
        expect(tampered.body.data.firstInvalid.sequence).toBe(
          victim.sequence.toString(),
        );
        expect(tampered.body.data.firstInvalid.reason).toMatch(/entry_hash/u);
      } finally {
        await prisma.$executeRaw`UPDATE platform_audit SET reason = ${victim.reason} WHERE platform_audit_id = ${victim.id}::uuid`;
        await prisma.$executeRawUnsafe(
          'ALTER TABLE platform_audit ENABLE TRIGGER trg_platform_audit_no_update_delete',
        );
      }
      expect(
        (await verifyPlatformAuditChain(prisma as unknown as PrismaService)).ok,
      ).toBe(true);
    });

    it('never stores credentials in audit details', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      await post(admin, `users/${target.id}/reset-password`, {
        temporaryPassword: 'Tam-Thoi-Rat-Dai-9!',
        version: 0,
        reason: REASON,
      }).expect(201);
      const entries = await auditRows({ subjectId: target.id });
      expect(plain(entries)).not.toContain('Tam-Thoi-Rat-Dai-9!');
      const stored = await prisma.commandCommit.findMany({
        where: { operation: 'PLATFORM_USER_RESET_PASSWORD' },
        orderBy: { committedAt: 'desc' },
        take: 1,
      });
      expect(plain(stored)).not.toContain('Tam-Thoi-Rat-Dai-9!');
    });
  });

  describe('P0-2 account and organization status', () => {
    it('revokes every session when an account is locked', async () => {
      const target = await bearer('COMPLIANCE_REVIEWER', 'AUDITOR');
      await get(target, 'auth/me').expect(200);
      await patch(admin, `users/${target.id}/status`, {
        accountStatus: 'LOCKED',
        version: 0,
        reason: REASON,
      }).expect(200);
      await get(target, 'auth/me').expect(401);
      expect(
        await prisma.refreshSession.count({
          where: { userId: target.id, revokedAt: null },
        }),
      ).toBe(0);
    });

    it('refuses an administrator locking their own account', async () => {
      await patch(admin, `users/${admin.id}/status`, {
        accountStatus: 'LOCKED',
        version: 0,
        reason: REASON,
      }).expect(409);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } }))
          .accountStatus,
      ).toBe('ACTIVE');
    });

    it('changes organization status with version, reason and idempotency', async () => {
      const org = await prisma.organization.create({
        data: { name: `Gov org ${randomUUID()}`, type: 'FARM' },
      });
      await patch(admin, `organizations/${org.id}`, {
        status: 'INACTIVE',
        version: 0,
      }).expect(400);
      await patch(admin, `organizations/${org.id}`, {
        status: 'INACTIVE',
        version: 5,
        reason: REASON,
      }).expect(409);
      const ok = await patch(admin, `organizations/${org.id}`, {
        status: 'INACTIVE',
        version: 0,
        reason: REASON,
      }).expect(200);
      expect(ok.body.data.version).toBe(1);
      const [entry] = await auditRows({ subjectId: org.id });
      expect(entry).toMatchObject({
        action: 'ORGANIZATION_STATUS_CHANGED',
        organizationId: org.id,
        reason: REASON,
      });
    });

    it('forces a session logout of one platform user without locking them', async () => {
      const target = await bearer('COMPLIANCE_REVIEWER', 'AUDITOR');
      await get(target, 'auth/me').expect(200);
      const response = await post(admin, `users/${target.id}/revoke-sessions`, {
        reason: REASON,
      }).expect(201);
      expect(response.body.data.sessionsRevoked).toBeGreaterThanOrEqual(1);
      await get(target, 'auth/me').expect(401);
      expect(
        (await auditRows({ subjectId: target.id })).map((row) => row.action),
      ).toContain('USER_SESSIONS_REVOKED');
    });
  });

  describe('P0-4 passwords, forced change and temporary lockout', () => {
    it('gives unknown, wrong-password and locked accounts the same error', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      const unknown = await login(`nobody-${randomUUID()}@example.test`);
      const wrong = await login(target.email, {}, 'Wrong-Password-123');
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
      await login(target.email, {}, 'Wrong-Password-123');
      const third = await login(target.email, {}, 'Wrong-Password-123');
      expect(third.body.error.message).toBe(unknown.body.error.message);
      // Now locked: even the correct password gets the identical answer.
      const locked = await login(target.email);
      expect(locked.status).toBe(401);
      expect(locked.body.error.message).toBe(unknown.body.error.message);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      const lockEntry = (await auditRows({ subjectId: target.id })).find(
        (entry) => entry.action === 'USER_LOGIN_LOCKED',
      );
      expect(lockEntry).toMatchObject({
        actorRole: 'SYSTEM',
        actorUserId: null,
      });
      // Admin unlock clears it and is audited with a reason.
      await post(admin, `users/${target.id}/unlock`, {
        version: row.version,
        reason: REASON,
      }).expect(201);
      await login(target.email).expect(201);
      expect(
        (await auditRows({ subjectId: target.id })).map(
          (entry) => entry.action,
        ),
      ).toContain('USER_UNLOCKED');
    });

    it('does not lock enterprise accounts (targeted-lockout abuse)', async () => {
      const target = await makeUser('FARM_STAFF', 'FARM');
      for (let i = 0; i < 5; i += 1)
        await login(target.email, {}, 'Wrong-Password-123').expect(401);
      await login(target.email).expect(201);
    });

    it('resets a password to a temporary one that must be changed at first login', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      const reset = await post(admin, `users/${target.id}/reset-password`, {
        temporaryPassword: 'Mat-Khau-Tam-Thoi-77',
        version: 0,
        reason: REASON,
      }).expect(201);
      expect(reset.body.data.mustChangePassword).toBe(true);
      expect(JSON.stringify(reset.body)).not.toContain('Mat-Khau-Tam-Thoi-77');
      await login(target.email).expect(401);
      const session = await login(
        target.email,
        {},
        'Mat-Khau-Tam-Thoi-77',
      ).expect(201);
      const token = session.body.data.accessToken as string;
      expect(session.body.data.user.mustChangePassword).toBe(true);
      // Everything except the way out is refused.
      await get({ token }, 'users').expect(403);
      await get({ token }, 'auth/me').expect(200);
      const other = await login(
        target.email,
        {},
        'Mat-Khau-Tam-Thoi-77',
      ).expect(201);
      await post(
        { token },
        'auth/change-password',
        {
          currentPassword: 'Mat-Khau-Tam-Thoi-77',
          newPassword: 'Mat-Khau-Tam-Thoi-77',
        },
        null,
      ).expect(409);
      const changed = await post(
        { token },
        'auth/change-password',
        {
          currentPassword: 'Mat-Khau-Tam-Thoi-77',
          newPassword: 'Mat-Khau-Moi-Cua-Toi-88',
        },
        null,
      ).expect(201);
      expect(changed.body.data.sessionsRevoked).toBe(1);
      await get({ token }, 'auth/me').expect(200);
      await get({ token: other.body.data.accessToken }, 'auth/me').expect(401);
      await login(target.email, {}, 'Mat-Khau-Tam-Thoi-77').expect(401);
      await login(target.email, {}, 'Mat-Khau-Moi-Cua-Toi-88').expect(201);
      expect(
        (await auditRows({ subjectId: target.id })).map(
          (entry) => entry.action,
        ),
      ).toEqual(
        expect.arrayContaining(['USER_PASSWORD_RESET', 'PASSWORD_CHANGED']),
      );
    });

    it('lets a user sign out of every session', async () => {
      const target = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      const a = await login(target.email).expect(201);
      const b = await login(target.email).expect(201);
      // A second login on the same browser would revoke the first; both are
      // independent here because no previous refresh cookie is sent.
      expect(a.body.data.sessionId).not.toBe(b.body.data.sessionId);
      await post(
        { token: b.body.data.accessToken },
        'auth/logout-all',
        {},
        null,
      ).expect(201);
      await get({ token: a.body.data.accessToken }, 'auth/me').expect(401);
      await get({ token: b.body.data.accessToken }, 'auth/me').expect(401);
    });
  });

  describe('P0-3 TOTP MFA for SYSTEM_ADMIN', () => {
    it('enrols, requires the code at login and consumes codes once', async () => {
      const mfaAdmin = await makeUser('SYSTEM_ADMIN');
      mfaAdmin.token = (
        await login(mfaAdmin.email).expect(201)
      ).body.data.accessToken;
      expect(
        (await get(mfaAdmin, 'auth/mfa').expect(200)).body.data.status,
      ).toBe('NONE');
      const enrolled = await post(
        mfaAdmin,
        'auth/mfa/enroll',
        { currentPassword: PASSWORD },
        null,
      ).expect(201);
      const secret = enrolled.body.data.secret as string;
      expect(enrolled.body.data.otpauthUri).toContain('otpauth://totp/');
      const stored = await prisma.platformMfa.findUniqueOrThrow({
        where: { userId: mfaAdmin.id },
      });
      expect(stored.secretCiphertext).not.toContain(secret);
      await post(mfaAdmin, 'auth/mfa/verify', { code: '000000' }, null).expect(
        422,
      );
      const verified = await post(
        mfaAdmin,
        'auth/mfa/verify',
        { code: hotp(secret, totpStep()) },
        null,
      ).expect(201);
      const recovery = verified.body.data.recoveryCodes as string[];
      expect(recovery).toHaveLength(10);
      const row = await prisma.platformMfa.findUniqueOrThrow({
        where: { userId: mfaAdmin.id },
      });
      expect(JSON.stringify(row.recoveryCodeHashes)).not.toContain(recovery[0]);
      expect(row.status).toBe('ENABLED');

      // Login now needs the second factor.
      const missing = await login(mfaAdmin.email).expect(401);
      expect(missing.body.error.message).toBe('Cần mã xác thực hai yếu tố');
      await login(mfaAdmin.email, { mfaCode: '123456' }).expect(401);
      await login(mfaAdmin.email, {
        mfaCode: await freshCode(mfaAdmin.id, secret),
      }).expect(201);
      // The same code cannot be replayed within its time step.
      const replayCode = hotp(secret, totpStep());
      await prisma.platformMfa.update({
        where: { userId: mfaAdmin.id },
        data: { lastUsedStep: BigInt(totpStep() - 10) },
      });
      await login(mfaAdmin.email, { mfaCode: replayCode }).expect(201);
      await login(mfaAdmin.email, { mfaCode: replayCode }).expect(401);
      // A recovery code works once.
      await login(mfaAdmin.email, { mfaCode: recovery[0] }).expect(201);
      await login(mfaAdmin.email, { mfaCode: recovery[0] }).expect(401);
      expect(
        (await auditRows({ subjectId: mfaAdmin.id })).map(
          (entry) => entry.action,
        ),
      ).toEqual(
        expect.arrayContaining(['MFA_ENROLLMENT_STARTED', 'MFA_ENABLED']),
      );

      // Disable needs a valid code and is audited.
      await post(mfaAdmin, 'auth/mfa/disable', { code: '111111' }, null).expect(
        403,
      );
      mfaAdmin.token = await session(mfaAdmin);
      await post(
        mfaAdmin,
        'auth/mfa/disable',
        { code: await freshCode(mfaAdmin.id, secret) },
        null,
      ).expect(201);
      expect(
        await prisma.platformMfa.findUnique({ where: { userId: mfaAdmin.id } }),
      ).toBeNull();
      expect(
        (await auditRows({ subjectId: mfaAdmin.id })).map(
          (entry) => entry.action,
        ),
      ).toContain('MFA_DISABLED');
      await login(mfaAdmin.email).expect(201);
    });

    it('does not allow MFA enrolment for non-administrators', async () => {
      await post(auditor, 'auth/mfa/enroll', {}, null).expect(403);
    });
  });

  describe('P0-5 maker-checker', () => {
    const grantCapability = (org: string, actor = admin, key?: string) =>
      post(
        actor,
        'platform-approvals',
        {
          operation: 'CAPABILITY_GRANT',
          params: { organizationId: org, code: 'TRANSPORTER' },
          reason: REASON,
        },
        key,
      );
    const decide = (
      id: string,
      version: number,
      decision: 'APPROVE' | 'REJECT',
      actor = admin2,
      key?: string,
      extra: Record<string, string> = {},
    ) =>
      post(
        actor,
        `platform-approvals/${id}/decision`,
        { decision, version, note: 'Đã đối chiếu hồ sơ năng lực' },
        key,
        extra,
      );

    afterEach(() => {
      delete process.env.PLATFORM_APPROVALS_MODE;
      delete process.env.PLATFORM_MFA_MODE;
    });

    it('keeps the direct path while the policy is OFF and blocks it once ENFORCED', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      await post(admin, `organizations/${org.id}/capabilities`, {
        code: 'DISTRIBUTOR',
      }).expect(201);
      process.env.PLATFORM_APPROVALS_MODE = 'ENFORCED';
      await post(admin, `organizations/${org.id}/capabilities`, {
        code: 'TRANSPORTER',
      }).expect(409);
      await post(admin, 'users', {
        email: `second-${randomUUID()}@example.test`,
        fullName: 'Quản trị thứ hai',
        roleCode: 'SYSTEM_ADMIN',
      }).expect(409);
      // Non-protected platform work (an auditor user) is unaffected.
      const auditorOrg = await prisma.organization.create({
        data: { name: `Aud org ${randomUUID()}`, type: 'AUDITOR' },
      });
      await post(admin, 'users', {
        email: `rev-${randomUUID()}@example.test`,
        fullName: 'Người kiểm định',
        roleCode: 'COMPLIANCE_REVIEWER',
        organizationId: auditorOrg.id,
      }).expect(201);
    });

    it('requires a different approver and executes exactly once on approval', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      const proposed = await grantCapability(org.id).expect(201);
      const approval = proposed.body.data;
      expect(approval.status).toBe('PENDING');
      expect(approval.payloadHash).toMatch(/^[0-9a-f]{64}$/u);
      // The same pending proposal cannot be duplicated.
      await grantCapability(org.id).expect(409);
      // Proposer cannot approve their own proposal.
      await decide(approval.id, 0, 'APPROVE', admin).expect(403);
      expect(
        await prisma.organizationCapability.count({
          where: { organizationId: org.id, code: 'TRANSPORTER' },
        }),
      ).toBe(0);
      const key = randomUUID();
      const approved = await decide(
        approval.id,
        0,
        'APPROVE',
        admin2,
        key,
      ).expect(201);
      expect(approved.body.data.status).toBe('APPROVED');
      expect(approved.body.data.decidedBy.id).toBe(admin2.id);
      expect(
        await prisma.organizationCapability.count({
          where: {
            organizationId: org.id,
            code: 'TRANSPORTER',
            revokedAt: null,
          },
        }),
      ).toBe(1);
      // Replay of the decision is idempotent; a new key finds it final.
      const replay = await decide(approval.id, 0, 'APPROVE', admin2, key);
      expect(replay.status).toBe(201);
      await decide(approval.id, 1, 'APPROVE', admin2).expect(409);
      const actions = (await auditRows({ organizationId: org.id })).map(
        (entry) => entry.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'APPROVAL_PROPOSED',
          'CAPABILITY_GRANTED',
          'APPROVAL_APPROVED',
        ]),
      );
      expect(actions.filter((a) => a === 'CAPABILITY_GRANTED')).toHaveLength(1);
    });

    it('does nothing on reject, allows cancel only by the proposer', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      const first = (await grantCapability(org.id).expect(201)).body.data;
      const rejected = await decide(first.id, 0, 'REJECT').expect(201);
      expect(rejected.body.data.status).toBe('REJECTED');
      expect(
        await prisma.organizationCapability.count({
          where: { organizationId: org.id, code: 'TRANSPORTER' },
        }),
      ).toBe(0);
      const second = (await grantCapability(org.id).expect(201)).body.data;
      await post(admin2, `platform-approvals/${second.id}/cancel`, {
        note: 'Không phải người đề xuất',
        version: 0,
      }).expect(403);
      const cancelled = await post(
        admin,
        `platform-approvals/${second.id}/cancel`,
        {
          note: 'Đề xuất nhầm tổ chức',
          version: 0,
        },
      ).expect(201);
      expect(cancelled.body.data.status).toBe('CANCELLED');
      await decide(second.id, 1, 'APPROVE').expect(409);
    });

    it('treats an expired proposal as expired and refuses to execute it', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      const stale = await prisma.platformApproval.create({
        data: {
          operation: 'CAPABILITY_GRANT',
          subjectType: 'ORGANIZATION',
          subjectId: org.id,
          organizationId: org.id,
          payload: { organizationId: org.id, code: 'TRANSPORTER' },
          payloadHash: 'a'.repeat(64),
          proposerId: admin.id,
          proposerReason: REASON,
          createdAt: new Date(Date.now() - 3 * 86_400_000),
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      });
      const listed = await get(
        admin,
        'platform-approvals?status=EXPIRED',
      ).expect(200);
      expect(
        listed.body.data.find((row: { id: string }) => row.id === stale.id)
          .effectiveStatus,
      ).toBe('EXPIRED');
      await decide(stale.id, 0, 'APPROVE').expect(409);
      expect(
        await prisma.organizationCapability.count({
          where: { organizationId: org.id, code: 'TRANSPORTER' },
        }),
      ).toBe(0);
    });

    it('enforces maker != checker and finality in the database as well', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      const row = (await grantCapability(org.id).expect(201)).body.data;
      await expect(
        prisma.$executeRaw`UPDATE platform_approval SET status='APPROVED', decided_by=${admin.id}::uuid, decided_at=now(), decision_note='Tự phê duyệt đề xuất của mình', result='{}'::jsonb WHERE platform_approval_id=${row.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        prisma.$executeRaw`UPDATE platform_approval SET payload='{"organizationId":"x"}'::jsonb WHERE platform_approval_id=${row.id}::uuid`,
      ).rejects.toThrow(/immutable/u);
      await expect(
        prisma.$executeRaw`DELETE FROM platform_approval WHERE platform_approval_id=${row.id}::uuid`,
      ).rejects.toThrow();
    });

    it('creates a second SYSTEM_ADMIN only through approval, never storing the password', async () => {
      process.env.PLATFORM_APPROVALS_MODE = 'ENFORCED';
      const email = `new-admin-${randomUUID()}@example.test`;
      const proposed = await post(admin, 'platform-approvals', {
        operation: 'SYSTEM_ADMIN_CREATE',
        params: {
          email,
          fullName: 'Quản trị viên mới',
        },
        reason: REASON,
      }).expect(201);
      const stored = await prisma.platformApproval.findUniqueOrThrow({
        where: { id: proposed.body.data.id },
      });
      expect(plain(stored)).not.toContain('Mat-Khau-Tam-Cua-QT-1');
      expect(proposed.body.data.payload.passwordHash).toBeUndefined();
      expect(await prisma.user.count({ where: { email } })).toBe(0);
      await decide(proposed.body.data.id, 0, 'APPROVE', admin).expect(403);
      await decide(proposed.body.data.id, 0, 'APPROVE', admin2).expect(201);
      const created = await prisma.user.findFirstOrThrow({
        where: { email },
        include: { role: true },
      });
      expect(created.role.code).toBe('SYSTEM_ADMIN');
      expect(created.mustChangePassword).toBe(true);
      const entry = (await auditRows({ subjectId: created.id })).find(
        (row) => row.action === 'USER_CREATED',
      );
      // The approved account receives a generated password by mail only.
      const mail = await prisma.enterpriseMail.findFirstOrThrow({
        where: { userId: created.id, kind: 'ACCOUNT_CREDENTIALS' },
      });
      const temporary = decryptOtp(mail.otpCiphertext!);
      expect(plain(entry)).not.toContain(temporary);
      expect(plain(stored)).not.toContain(temporary);
      await login(email, {}, temporary).expect(201);
    });

    it('grants CREATE_CHAIN only through approval when enforced', async () => {
      const org = await prisma.organization.create({
        data: { name: `Chain org ${randomUUID()}`, type: 'FARM' },
      });
      const member = await prisma.user.create({
        data: {
          fullName: 'Quản lý doanh nghiệp',
          email: `owner-${randomUUID()}@example.test`,
          organizationId: org.id,
          roleId: (await role('FARM_STAFF')).id,
          passwordHash: await passwordHash,
        },
      });
      process.env.PLATFORM_APPROVALS_MODE = 'ENFORCED';
      await post(admin, `organizations/${org.id}/scoped-grants`, {
        userId: member.id,
        role: 'CREATE_CHAIN',
      }).expect(409);
      const proposed = await post(admin, 'platform-approvals', {
        operation: 'CREATE_CHAIN_GRANT',
        params: { organizationId: org.id, userId: member.id },
        reason: REASON,
      }).expect(201);
      expect(
        await prisma.scopedRoleGrant.count({ where: { userId: member.id } }),
      ).toBe(0);
      await decide(proposed.body.data.id, 0, 'APPROVE').expect(201);
      expect(
        await prisma.scopedRoleGrant.count({
          where: { userId: member.id, role: 'CREATE_CHAIN', revokedAt: null },
        }),
      ).toBe(1);
    });

    it('requires an MFA step-up from an enrolled approver', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      const approver = await makeUser('SYSTEM_ADMIN');
      approver.token = await session(approver);
      const enrolled = await post(
        approver,
        'auth/mfa/enroll',
        { currentPassword: PASSWORD },
        null,
      ).expect(201);
      const secret = enrolled.body.data.secret as string;
      await post(
        approver,
        'auth/mfa/verify',
        { code: hotp(secret, totpStep()) },
        null,
      ).expect(201);
      const proposed = (await grantCapability(org.id).expect(201)).body.data;
      await decide(proposed.id, 0, 'APPROVE', approver).expect(403);
      await decide(proposed.id, 0, 'APPROVE', approver, undefined, {
        'X-MFA-Code': '000000',
      }).expect(403);
      const approved = await decide(
        proposed.id,
        0,
        'APPROVE',
        approver,
        undefined,
        { 'X-MFA-Code': await freshCode(approver.id, secret) },
      ).expect(201);
      expect(approved.body.data.status).toBe('APPROVED');
    });

    it('refuses high-risk work from an un-enrolled administrator when MFA is REQUIRED', async () => {
      process.env.PLATFORM_MFA_MODE = 'REQUIRED';
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      await grantCapability(org.id).expect(403);
    });
  });
  describe('review hardening', () => {
    afterEach(() => {
      delete process.env.PLATFORM_APPROVALS_MODE;
      delete process.env.PLATFORM_MFA_MODE;
    });

    it('keeps the session and the idempotency key usable after a wrong step-up code', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      const approver = await makeUser('SYSTEM_ADMIN');
      approver.token = await session(approver);
      const secret = (
        await post(
          approver,
          'auth/mfa/enroll',
          { currentPassword: PASSWORD },
          null,
        ).expect(201)
      ).body.data.secret as string;
      await post(
        approver,
        'auth/mfa/verify',
        { code: hotp(secret, totpStep()) },
        null,
      ).expect(201);
      const proposer = (
        await post(admin, 'platform-approvals', {
          operation: 'CAPABILITY_GRANT',
          params: { organizationId: org.id, code: 'RETAILER' },
          reason: REASON,
        }).expect(201)
      ).body.data;
      const key = randomUUID();
      const body = {
        decision: 'APPROVE',
        version: 0,
        note: 'Đã đối chiếu hồ sơ năng lực',
      };
      const url = `platform-approvals/${proposer.id}/decision`;
      const wrong = await post(approver, url, body, key, {
        'X-MFA-Code': '000000',
      });
      // 403, not 401: the web client must not treat this as an expired session.
      expect(wrong.status).toBe(403);
      await get(approver, 'auth/me').expect(200);
      // The same key and body now succeed with the right code: the failure
      // was not journaled.
      const ok = await post(approver, url, body, key, {
        'X-MFA-Code': await freshCode(approver.id, secret),
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.status).toBe('APPROVED');
      expect(
        await prisma.idempotencyRecord.count({
          where: { idempotencyKey: key },
        }),
      ).toBe(1);
    });

    it('requires the password to start MFA enrolment and reports a missing key as 503', async () => {
      const actor = await bearer('SYSTEM_ADMIN');
      await post(actor, 'auth/mfa/enroll', {}, null).expect(400);
      await post(
        actor,
        'auth/mfa/enroll',
        { currentPassword: 'Wrong-Password-123' },
        null,
      ).expect(403);
      const key = process.env.PLATFORM_SECRET_KEY;
      delete process.env.PLATFORM_SECRET_KEY;
      try {
        await post(
          actor,
          'auth/mfa/enroll',
          { currentPassword: PASSWORD },
          null,
        ).expect(503);
      } finally {
        process.env.PLATFORM_SECRET_KEY = key;
      }
      expect(
        await prisma.platformMfa.findUnique({ where: { userId: actor.id } }),
      ).toBeNull();
    });

    it('does not let one administrator take over another by resetting a password when approvals are enforced', async () => {
      const target = await makeUser('SYSTEM_ADMIN');
      process.env.PLATFORM_APPROVALS_MODE = 'ENFORCED';
      await post(admin, `users/${target.id}/reset-password`, {
        temporaryPassword: 'Chiem-Tai-Khoan-Admin-1',
        version: 0,
        reason: REASON,
      }).expect(409);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
          .mustChangePassword,
      ).toBe(false);
      await login(target.email).expect(201);
      const proposed = (
        await post(admin, 'platform-approvals', {
          operation: 'ADMIN_PASSWORD_RESET',
          params: {
            userId: target.id,
            temporaryPassword: 'Mat-Khau-Duoc-Duyet-9',
          },
          reason: REASON,
        }).expect(201)
      ).body.data;
      const stored = await prisma.platformApproval.findUniqueOrThrow({
        where: { id: proposed.id },
      });
      expect(plain(stored)).not.toContain('Mat-Khau-Duoc-Duyet-9');
      await post(admin, `platform-approvals/${proposed.id}/decision`, {
        decision: 'APPROVE',
        version: 0,
        note: 'Đã xác minh danh tính quản trị viên',
      }).expect(403);
      await post(admin2, `platform-approvals/${proposed.id}/decision`, {
        decision: 'APPROVE',
        version: 0,
        note: 'Đã xác minh danh tính quản trị viên',
      }).expect(201);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
          .mustChangePassword,
      ).toBe(true);
      await login(target.email).expect(401);
      await login(target.email, {}, 'Mat-Khau-Duoc-Duyet-9').expect(201);
      // Non-administrator platform accounts keep the direct path.
      const reviewer = await makeUser('COMPLIANCE_REVIEWER', 'AUDITOR');
      await post(admin, `users/${reviewer.id}/reset-password`, {
        temporaryPassword: 'Dat-Lai-Truc-Tiep-12',
        version: 0,
        reason: REASON,
      }).expect(201);
    });

    it('expires an overdue proposal so it no longer blocks the subject, and refuses a disabled proposer', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      const stale = await prisma.platformApproval.create({
        data: {
          operation: 'CAPABILITY_GRANT',
          subjectType: 'ORGANIZATION',
          subjectId: org.id,
          organizationId: org.id,
          payload: { organizationId: org.id, code: 'TRANSPORTER' },
          payloadHash: 'b'.repeat(64),
          proposerId: admin.id,
          proposerReason: REASON,
          createdAt: new Date(Date.now() - 3 * 86_400_000),
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      });
      // A fresh proposal for the same subject is accepted and expires the old one.
      const fresh = (
        await post(admin, 'platform-approvals', {
          operation: 'CAPABILITY_GRANT',
          params: { organizationId: org.id, code: 'TRANSPORTER' },
          reason: REASON,
        }).expect(201)
      ).body.data;
      const expired = await prisma.platformApproval.findUniqueOrThrow({
        where: { id: stale.id },
      });
      expect(expired).toMatchObject({ status: 'EXPIRED', decidedBy: null });
      expect(
        (await auditRows({ subjectId: stale.id })).map((row) => row.action),
      ).toContain('APPROVAL_EXPIRED');
      const entry = (await auditRows({ subjectId: stale.id })).find(
        (row) => row.action === 'APPROVAL_EXPIRED',
      );
      expect(entry).toMatchObject({ actorRole: 'SYSTEM', actorUserId: null });

      // A proposer who can no longer act cannot have their proposal approved,
      // but any administrator can clear it.
      const proposer = await bearer('SYSTEM_ADMIN');
      const second = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      const doomed = (
        await post(proposer, 'platform-approvals', {
          operation: 'CAPABILITY_GRANT',
          params: { organizationId: second.id, code: 'RETAILER' },
          reason: REASON,
        }).expect(201)
      ).body.data;
      await prisma.user.update({
        where: { id: proposer.id },
        data: { accountStatus: 'INACTIVE' },
      });
      await post(admin2, `platform-approvals/${doomed.id}/decision`, {
        decision: 'APPROVE',
        version: 0,
        note: 'Đã đối chiếu hồ sơ năng lực',
      }).expect(409);
      await post(admin2, `platform-approvals/${doomed.id}/cancel`, {
        note: 'Người đề xuất đã bị vô hiệu hóa',
        version: 0,
      }).expect(201);
      // Cancelling a live proposal still belongs to its proposer alone.
      await post(admin2, `platform-approvals/${fresh.id}/cancel`, {
        note: 'Không phải người đề xuất',
        version: 0,
      }).expect(403);
    });

    it('rejects prototype-key capability codes instead of failing at approval time', async () => {
      const org = await prisma.organization.create({
        data: { name: `Cap org ${randomUUID()}`, type: 'FARM' },
      });
      for (const code of ['toString', 'constructor', '__proto__'])
        await post(admin, 'platform-approvals', {
          operation: 'CAPABILITY_GRANT',
          params: { organizationId: org.id, code },
          reason: REASON,
        }).expect(422);
    });

    it('settles a burst of concurrent audited writes without deadlock and keeps the chain intact', async () => {
      const a = await bearer('SYSTEM_ADMIN');
      const b = await bearer('SYSTEM_ADMIN');
      const reviewers = await Promise.all(
        Array.from({ length: 4 }, () =>
          makeUser('COMPLIANCE_REVIEWER', 'AUDITOR'),
        ),
      );
      const orgs = await Promise.all(
        Array.from({ length: 2 }, () =>
          prisma.organization.create({
            data: { name: `Burst org ${randomUUID()}`, type: 'FARM' },
          }),
        ),
      );
      const results = await Promise.all([
        // Two administrators act on each other while others work in parallel.
        patch(a, `users/${b.id}/status`, {
          accountStatus: 'INACTIVE',
          version: 0,
          reason: REASON,
        }),
        patch(b, `users/${a.id}/status`, {
          accountStatus: 'INACTIVE',
          version: 0,
          reason: REASON,
        }),
        ...reviewers.map((reviewer) =>
          patch(admin, `users/${reviewer.id}/status`, {
            accountStatus: 'LOCKED',
            version: 0,
            reason: REASON,
          }),
        ),
        ...orgs.map((org) =>
          patch(admin2, `organizations/${org.id}`, {
            status: 'INACTIVE',
            version: 0,
            reason: REASON,
          }),
        ),
        login(reviewers[0].email, {}, 'Wrong-Password-123'),
        login(reviewers[1].email, {}, 'Wrong-Password-123'),
      ]);
      // No request may end in a server error (deadlock victims surface as 500).
      expect(
        results
          .map((result) => result.status)
          .filter((status) => status >= 500),
      ).toEqual([]);
      // At most one of the two mutual disables can win: the loser's actor is
      // already inactive. Both would mean the last-admin guard raced.
      const mutual = results.slice(0, 2).map((result) => result.status);
      expect(mutual.filter((status) => status === 200).length).toBe(1);
      expect(
        (await verifyPlatformAuditChain(prisma as unknown as PrismaService)).ok,
      ).toBe(true);
      await prisma.user.updateMany({
        where: { id: { in: [a.id, b.id] } },
        data: { accountStatus: 'INACTIVE' },
      });
    });
  });
});
