import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { provisionChain } from './support/chain-scope.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
let app: INestApplication;
let jwt: JwtService;

interface Actor {
  id: string;
  token: string;
}
async function actorWith(
  code: string,
  orgType: 'FARM' | 'AUDITOR' | null,
  organizationId?: string,
) {
  const org = organizationId
    ? { id: organizationId }
    : orgType
      ? await prisma.organization.create({
          data: { name: `Ops test ${randomUUID()}`, type: orgType },
        })
      : null;
  const role = await prisma.role.upsert({
    where: { code },
    create: { code, name: code },
    update: {},
  });
  const user = await prisma.user.create({
    data: {
      fullName: code,
      email: `ops-${randomUUID()}@example.test`,
      organizationId: org?.id,
      roleId: role.id,
      passwordHash: 'unused-in-this-suite',
    },
  });
  const session = await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return {
    id: user.id,
    token: jwt.sign({ sub: user.id, sid: session.id }),
  } satisfies Actor;
}
const get = (actor: Actor, path: string) =>
  request(app.getHttpServer())
    .get(`/api/platform-operations/${path}`)
    .set('Authorization', `Bearer ${actor.token}`);

type OutboxSeed = Omit<Prisma.BlockchainOutboxUncheckedCreateInput, 'eventId'>;

/** Operational rows normally arrive through the full trace/ledger pipeline.
 * This fixture inserts a trace event with its outbox row directly, with user
 * triggers disabled for the transaction only (isolated test database). */
async function seed(
  organizationId: string,
  outbox: OutboxSeed,
  chainId?: string,
) {
  const eventId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.traceEvent.create({
      data: {
        id: eventId,
        entityType: 'LOT',
        entityId: randomUUID(),
        eventType: 'OPS_TEST',
        actorRole: 'FARM_STAFF',
        actorOrganizationId: organizationId,
        eventTime: new Date(),
        businessData: {},
        dataHash: randomUUID().replace(/-/gu, '').repeat(2),
      },
    });
    if (chainId)
      await tx.eventChainContext.create({ data: { eventId, chainId } });
    await tx.blockchainOutbox.create({ data: { ...outbox, eventId } });
  });
  return eventId;
}

describe('Platform operations dashboard (real PostgreSQL, read-only)', () => {
  let admin: Actor;
  let auditor: Actor;
  let farm: Actor;
  let orgA: string;
  let orgB: string;
  let chainA: string;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'platform-operations-tests-only-secret',
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
    jwt = app.get(JwtService);
    admin = await actorWith('SYSTEM_ADMIN', null);
    auditor = await actorWith('AUDITOR', 'AUDITOR');
    farm = await actorWith('FARM_STAFF', 'FARM');
    orgA = (
      await prisma.organization.create({
        data: { name: `Ops A ${randomUUID()}`, type: 'FARM' },
      })
    ).id;
    orgB = (
      await prisma.organization.create({
        data: { name: `Ops B ${randomUUID()}`, type: 'FARM' },
      })
    ).id;
    chainA = await provisionChain(prisma, {
      name: `Ops chain ${randomUUID()}`,
      ownerOrganizationId: orgA,
      memberOrganizationIds: [],
      grants: [],
    });
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('is readable by SYSTEM_ADMIN and AUDITOR only, and exposes no write route', async () => {
    for (const path of [
      'summary',
      'outbox',
      'holds',
      'ledger-jobs',
      'binding-health',
      'mail',
    ]) {
      await get(admin, path).expect(200);
      await get(auditor, path).expect(200);
      await get(farm, path).expect(403);
    }
    for (const verb of ['post', 'patch', 'put', 'delete'] as const)
      await request(app.getHttpServer())
        [verb]('/api/platform-operations/outbox')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({})
        .expect(404);
  });

  it('counts the outbox by status, ages the oldest entry and scopes by organization and chain', async () => {
    const old = new Date(Date.now() - 3 * 3_600_000);
    await seed(
      orgA,
      { status: 'PENDING', createdAt: old, nextAttemptAt: old },
      chainA,
    );
    await seed(orgA, {
      status: 'DEAD_LETTER',
      attemptCount: 5,
      lastError: 'connect ECONNREFUSED 10.0.0.9:7051\n    at somewhere'.repeat(
        20,
      ),
    });
    await seed(orgB, { status: 'COMPLETED', completedAt: new Date() });
    const summary = (
      await get(admin, `summary?organizationId=${orgA}`).expect(200)
    ).body.data;
    expect(summary.filters).toEqual({ chainId: null, organizationId: orgA });
    expect(summary.outbox.counts).toMatchObject({
      PENDING: 1,
      DEAD_LETTER: 1,
      COMPLETED: 0,
    });
    expect(summary.outbox.oldestUnfinishedAgeSeconds).toBeGreaterThanOrEqual(
      3 * 3600 - 5,
    );
    expect(summary.outbox.overdue).toBe(1);
    expect(summary.outbox.scopedBy).toEqual(['chain', 'organization']);
    expect(summary.mail.scopedBy).toEqual(['organization']);

    const byChain = (await get(admin, `summary?chainId=${chainA}`).expect(200))
      .body.data;
    expect(byChain.outbox.counts).toMatchObject({ PENDING: 1, DEAD_LETTER: 0 });

    const other = (
      await get(admin, `summary?organizationId=${orgB}`).expect(200)
    ).body.data;
    expect(other.outbox.counts).toMatchObject({ PENDING: 0, COMPLETED: 1 });
  });

  it('lists unfinished work with cursor pagination, hides finished work by default and bounds error text', async () => {
    for (let index = 0; index < 5; index += 1)
      await seed(orgB, {
        status: 'RETRY',
        attemptCount: index,
        createdAt: new Date(Date.now() - (10 - index) * 60_000),
        lastError: `fail ${'x'.repeat(1000)}
second line`,
      });
    const first = (
      await get(admin, `outbox?organizationId=${orgB}&limit=3`).expect(200)
    ).body.data;
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await get(
        admin,
        `outbox?organizationId=${orgB}&limit=3&cursor=${first.nextCursor}`,
      ).expect(200)
    ).body.data;
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map(
      (item: { id: string }) => item.id,
    );
    expect(new Set(ids).size).toBe(5);
    for (const item of first.items) {
      expect(item.status).toBe('RETRY');
      expect(item.lastError.length).toBeLessThanOrEqual(300);
      expect(item.lastError).not.toContain('\n');
    }
    // COMPLETED outbox rows are not "work": only when explicitly asked for.
    const completed = (
      await get(admin, `outbox?organizationId=${orgB}&status=COMPLETED`).expect(
        200,
      )
    ).body.data;
    expect(
      completed.items.every(
        (item: { status: string }) => item.status === 'COMPLETED',
      ),
    ).toBe(true);
    const defaults = (
      await get(admin, `outbox?organizationId=${orgB}&limit=100`).expect(200)
    ).body.data;
    expect(
      defaults.items.some(
        (item: { status: string }) => item.status === 'COMPLETED',
      ),
    ).toBe(false);
    await get(admin, 'outbox?status=NOPE').expect(422);
    await get(admin, 'outbox?cursor=not-a-cursor').expect(422);
    await get(admin, 'outbox?limit=0').expect(400);
    await get(admin, 'outbox?chainId=nope').expect(400);
  });

  it('reports ledger jobs, open holds and binding health per chain', async () => {
    const digest = randomUUID().replace(/-/gu, '').repeat(2);
    const route = randomUUID().replace(/-/gu, '').repeat(2);
    const other = await provisionChain(prisma, {
      name: `Ops other ${randomUUID()}`,
      ownerOrganizationId: orgB,
      memberOrganizationIds: [],
      grants: [],
    });
    // A network binding normally needs the full ledger onboarding; the
    // dashboard only reads these rows, so seed them with triggers disabled.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.fabricNetworkBinding.create({
        data: {
          digest,
          chainId: chainA,
          chainRef: randomUUID(),
          network: 'ops-test',
          channelId: 'agritrace',
          chaincodeName: 'agritrace',
          contractName: 'AgriTrace',
          envelopeVersion: '4.0.0',
          writerAuthority: 'ops-test',
          writerMspId: 'OpsMSP',
          writerRole: 'relayer',
          governanceDigest: 'a'.repeat(64),
          profile: 'SERVICE',
          routeDigest: route,
        },
      });
      await tx.deliveryHold.createMany({
        data: [
          {
            bindingDigest: digest,
            scope: 'BINDING',
            reason: `Peer unreachable\n${'x'.repeat(600)}`,
            openedAt: new Date(Date.now() - 2 * 3_600_000),
          },
          {
            bindingDigest: digest,
            scope: 'BINDING',
            reason: 'Resolved earlier',
            resolvedAt: new Date(),
            resolution: 'fixed',
          },
        ],
      });
      await tx.ledgerControlJob.createMany({
        data: [
          {
            bindingDigest: digest,
            operation: 'FENCE_DELIVERY',
            eventId: randomUUID(),
            expectedRevision: 1,
            status: 'FAILED',
            attemptCount: 4,
            lastError: 'timeout\nwaiting for endorsement',
          },
          {
            bindingDigest: digest,
            operation: 'FENCE_DELIVERY',
            eventId: randomUUID(),
            expectedRevision: 1,
            status: 'COMPLETED',
          },
        ],
      });
      await tx.bindingWorkerHealth.create({
        data: {
          bindingDigest: digest,
          lastCheckedAt: new Date(Date.now() - 30 * 60_000),
          lastHealthyAt: new Date(Date.now() - 3_600_000),
          lastErrorCode: 'PEER_UNREACHABLE',
          certificateExpiresAt: new Date(Date.now() + 5 * 86_400_000),
        },
      });
    });

    const summary = (await get(admin, `summary?chainId=${chainA}`).expect(200))
      .body.data;
    expect(summary.holds.open).toBe(1);
    expect(summary.holds.oldestOpenAgeSeconds).toBeGreaterThanOrEqual(7_190);
    expect(summary.ledgerJobs.counts).toMatchObject({
      FAILED: 1,
      COMPLETED: 1,
    });
    expect(summary.bindingHealth).toMatchObject({ total: 1, unhealthy: 1 });
    // Another chain sees none of it.
    const empty = (await get(admin, `summary?chainId=${other}`).expect(200))
      .body.data;
    expect(empty.holds.open).toBe(0);
    expect(empty.ledgerJobs.counts.FAILED).toBe(0);
    expect(empty.bindingHealth.total).toBe(0);

    const holds = (await get(admin, `holds?chainId=${chainA}`).expect(200)).body
      .data.items;
    expect(holds).toHaveLength(1);
    expect(holds[0].reason.length).toBeLessThanOrEqual(300);
    expect(holds[0].reason).not.toContain('\n');
    const jobs = (await get(admin, `ledger-jobs?chainId=${chainA}`).expect(200))
      .body.data.items;
    // Finished jobs are not work; the failed one is listed with a bounded error.
    expect(jobs.map((job: { status: string }) => job.status)).toEqual([
      'FAILED',
    ]);
    expect(jobs[0].lastError).toBe('timeout waiting for endorsement');
    const health = (
      await get(admin, `binding-health?chainId=${chainA}`).expect(200)
    ).body.data.items;
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({
      bindingDigest: digest.slice(0, 16),
      lastErrorCode: 'PEER_UNREACHABLE',
      stale: true,
    });
    expect(JSON.stringify(health)).not.toContain(digest);
    await get(admin, `ledger-jobs?chainId=${chainA}&status=COMPLETED`)
      .expect(200)
      .then((res) => expect(res.body.data.items).toHaveLength(1));
  });

  it('classifies certificate expiry bands and lists revocations without exposing key material', async () => {
    const chain = await provisionChain(prisma, {
      name: `Ops creds ${randomUUID()}`,
      ownerOrganizationId: orgB,
      memberOrganizationIds: [],
      grants: [],
    });
    const days = (n: number) => new Date(Date.now() + n * 86_400_000);
    const bindings = [
      { expires: days(-2), band: 'expired' },
      { expires: days(3), band: 'within7Days' },
      { expires: days(10), band: 'within14Days' },
      { expires: days(25), band: 'within30Days' },
      { expires: days(200), band: 'none' },
    ].map((entry) => ({
      ...entry,
      digest: randomUUID().replace(/-/gu, '').repeat(2),
    }));
    const secretFingerprint = 'f'.repeat(64);
    const publicKeyHash = 'e'.repeat(64);
    const keyRef = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      for (const binding of bindings) {
        await tx.fabricNetworkBinding.create({
          data: {
            digest: binding.digest,
            chainId: chain,
            chainRef: randomUUID(),
            network: 'ops-test',
            channelId: 'agritrace',
            chaincodeName: 'agritrace',
            contractName: 'AgriTrace',
            envelopeVersion: '4.0.0',
            writerAuthority: 'ops-test',
            writerMspId: 'OpsMSP',
            writerRole: 'relayer',
            governanceDigest: 'a'.repeat(64),
            profile: 'SERVICE',
            routeDigest: randomUUID().replace(/-/gu, '').repeat(2),
          },
        });
        // One instant: the schema requires last_healthy_at <= last_checked_at.
        const observedAt = new Date();
        await tx.bindingWorkerHealth.create({
          data: {
            bindingDigest: binding.digest,
            lastCheckedAt: observedAt,
            lastHealthyAt: observedAt,
            certificateExpiresAt: binding.expires,
          },
        });
      }
      await tx.fabricCredentialRevision.create({
        data: {
          bindingDigest: bindings[0].digest,
          certFingerprint: secretFingerprint,
          status: 'REVOKED',
          revokedAt: new Date(),
        },
      });
      await tx.fabricCredentialRevision.create({
        data: {
          bindingDigest: bindings[1].digest,
          certFingerprint: 'd'.repeat(64),
        },
      });
      const registrar = await tx.user.findFirstOrThrow({
        where: { id: admin.id },
        select: { id: true },
      });
      await tx.signingKey.create({
        data: {
          keyRef,
          chainId: chain,
          bindingDigest: bindings[0].digest,
          organizationId: orgB,
          label: 'Thiết bị ký đã thu hồi',
          publicKey: 'p'.repeat(59),
          publicKeyHash,
          popSignature: 's'.repeat(86),
          status: 'REVOKED',
          registeredBy: registrar.id,
          revokedAt: new Date(),
          revokeReason: 'Mất thiết bị\nđã báo cáo',
        },
      });
    });

    const view = (await get(admin, `credentials?chainId=${chain}`).expect(200))
      .body.data;
    expect(view.certificates).toMatchObject({
      expired: 1,
      within7Days: 1,
      within14Days: 1,
      within30Days: 1,
      unknownExpiry: 0,
    });
    // Only certificates expired or expiring within 30 days are listed, soonest first.
    expect(
      view.certificates.items.map((item: { bucket: string }) => item.bucket),
    ).toEqual(['EXPIRED', '7_DAYS', '14_DAYS', '30_DAYS']);
    expect(view.certificates.items[0].daysLeft).toBeLessThan(0);
    expect(view.credentials).toMatchObject({ approved: 1, revoked: 1 });
    expect(view.credentials.items[0].fingerprint).toBe(
      secretFingerprint.slice(0, 16),
    );
    expect(view.signingKeys.expiryTracked).toBe(false);
    expect(view.signingKeys.counts).toMatchObject({ REVOKED: 1, ACTIVE: 0 });
    expect(view.signingKeys.items[0]).toMatchObject({
      keyRef,
      revokeReason: 'Mất thiết bị đã báo cáo',
    });
    const text = JSON.stringify(view);
    for (const secret of [
      secretFingerprint,
      publicKeyHash,
      'p'.repeat(59),
      's'.repeat(86),
    ])
      expect(text).not.toContain(secret);
    for (const binding of bindings) expect(text).not.toContain(binding.digest);

    // The signing-key view honours the organization filter; another one is empty.
    const otherOrg = (
      await get(admin, `credentials?organizationId=${orgA}`).expect(200)
    ).body.data;
    expect(otherOrg.signingKeys.counts.REVOKED).toBe(0);
    await get(auditor, `credentials?chainId=${chain}`).expect(200);
    await get(farm, 'credentials').expect(403);
  });

  it('shows the mail queue without recipients, subjects or bodies', async () => {
    const secretRecipient = `private-${randomUUID()}@example.test`;
    await prisma.$transaction(async (tx) => {
      // The subject rows (verification) are outside this fixture's scope.
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.enterpriseMail.createMany({
        data: [
          {
            kind: 'REGISTRATION_OTP',
            verificationId: randomUUID(),
            recipient: secretRecipient,
            subject: 'Mã xác thực riêng tư',
            text: 'Nội dung thư không được lộ',
            status: 'PENDING',
            attempts: 3,
            nextAttemptAt: new Date(Date.now() - 3_600_000),
            createdAt: new Date(Date.now() - 7_200_000),
          },
          {
            kind: 'REGISTRATION_OTP',
            verificationId: randomUUID(),
            recipient: secretRecipient,
            subject: 'Đã gửi',
            text: 'Đã gửi',
            status: 'SENT',
            attempts: 1,
            sentAt: new Date(),
          },
        ],
      });
    });
    const summary = (await get(admin, 'summary').expect(200)).body.data;
    expect(summary.mail.counts.PENDING).toBeGreaterThanOrEqual(1);
    expect(summary.mail.retrying).toBeGreaterThanOrEqual(1);
    expect(summary.mail.overdue).toBeGreaterThanOrEqual(1);
    expect(summary.mail.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(7_190);
    const list = await get(admin, 'mail?status=RETRYING&limit=100').expect(200);
    expect(list.body.data.items.length).toBeGreaterThanOrEqual(1);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain(secretRecipient);
    expect(text).not.toContain('Mã xác thực riêng tư');
    expect(text).not.toContain('Nội dung thư không được lộ');
    expect(Object.keys(list.body.data.items[0]).sort()).toEqual(
      [
        'ageSeconds',
        'attempts',
        'createdAt',
        'id',
        'kind',
        'nextAttemptAt',
        'organization',
        'sentAt',
        'status',
      ].sort(),
    );
  });

  it('counts active sessions, locked and disabled accounts without listing people', async () => {
    // Other suites leave short-lived sessions behind. Scope this measurement
    // to its own organization so their expiry cannot change its baseline.
    const organization = await prisma.organization.create({
      data: { name: `Session counts ${randomUUID()}`, type: 'AUDITOR' },
    });
    const path = `summary?organizationId=${organization.id}`;
    const before = (await get(admin, path).expect(200)).body.data.accounts;
    expect(before.activeSessions).toBe(0);
    const victim = await actorWith(
      'COMPLIANCE_REVIEWER',
      null,
      organization.id,
    );
    await prisma.user.update({
      where: { id: victim.id },
      data: { lockedUntil: new Date(Date.now() + 600_000) },
    });
    const disabled = await actorWith(
      'COMPLIANCE_REVIEWER',
      null,
      organization.id,
    );
    await prisma.user.update({
      where: { id: disabled.id },
      data: { accountStatus: 'LOCKED' },
    });
    await prisma.refreshSession.createMany({
      data: [
        {
          userId: victim.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() - 60_000),
        },
        {
          userId: victim.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3_600_000),
          revokedAt: new Date(),
        },
      ],
    });
    const after = (await get(admin, path).expect(200)).body.data.accounts;
    expect(after.lockedAccounts).toBe(before.lockedAccounts + 1);
    expect(after.disabledAccounts).toBe(before.disabledAccounts + 1);
    expect(after.activeSessions).toBe(before.activeSessions + 2);
    expect(Object.keys(after).sort()).toEqual(
      [
        'activeSessions',
        'disabledAccounts',
        'lockedAccounts',
        'scopedBy',
      ].sort(),
    );
  });
});
