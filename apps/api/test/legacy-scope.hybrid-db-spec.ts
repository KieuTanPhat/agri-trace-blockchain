import {
  ConflictException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import type { CommandActor } from '../src/common/idempotency/command-authorization.js';
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import {
  applyLegacyScopeRoot,
  confirmLegacyScopeProposal,
  legacyReviewKeys,
  registerLegacyScopeManifest,
} from '../src/modules/supply-chains/legacy-scope.commands.js';
import { inventoryLegacyScope } from '../src/modules/supply-chains/legacy-scope-inventory.js';
import {
  legacyHistoryFixture,
  installLegacyPin,
} from './support/legacy-scope-fixture.js';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const serviceDb = db as unknown as PrismaService;
const trace = new TraceService(
  serviceDb,
  new OrganizationAccessService(serviceDb),
);
type Fixture = Awaited<ReturnType<typeof legacyHistoryFixture>>;

async function snapshot(tx: Prisma.TransactionClient, fixture: Fixture) {
  const inventory = await inventoryLegacyScope(tx, {
    cycleIds: fixture.cycles.map((c) => c.id),
  });
  // PostgreSQL JSON retains microseconds that a Prisma JS Date cannot retain.
  // Hash inside the process; never print private rows or QR tokens in evidence.
  const timestamps = [];
  for (const cycle of fixture.cycles) {
    const [row] = await tx.$queryRaw<
      Array<{ value: string }>
    >`SELECT (to_jsonb(c)-'chain_id')::text AS value FROM production_cycle c WHERE cycle_id=${cycle.id}::uuid`;
    timestamps.push(createHash('sha256').update(row.value).digest('hex'));
  }
  return { inventory, timestamps };
}

async function confirmations(
  tx: Prisma.TransactionClient,
  f: Fixture,
  omit?: string,
) {
  for (const key of Object.keys(legacyReviewKeys(f.pin)))
    await confirmLegacyScopeProposal(tx, f.producer, f.pin.manifest.id, key);
  for (const p of f.pin.plan.proposals) {
    if (p.key === omit) continue;
    const actor = f.actors.find((a) => a.organizationId === p.organizationId)!;
    await confirmLegacyScopeProposal(tx, actor, f.pin.manifest.id, p.key);
  }
}

async function scenario(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error('successful-history-scenario-rollback');
  try {
    await db.$transaction(
      async (tx) => {
        await work(tx);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        throw rollback;
      },
      { timeout: 20000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

beforeAll(async () => {
  expect(process.env.HYBRID_DRAFT_TESTS).toBe('1');
  expect(await db.lot.count({ where: { lotCode: 'scope-lot' } })).toBe(1);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('Legacy history preservation on isolated PostgreSQL', () => {
  it('requires each assignment consent and preserves multi-harvest, Shipment, QR, proof, outbox and exact timestamps across apply and resume', () =>
    scenario(async (tx) => {
      const f = await legacyHistoryFixture(tx, trace);
      const pins = installLegacyPin(f.pin);
      try {
        const before = await snapshot(tx, f);
        expect(
          before.inventory.roots.map((r) => r.counts.harvests).sort(),
        ).toEqual([1, 2]);
        expect(
          before.inventory.roots.reduce((sum, r) => sum + r.counts.proofs, 0),
        ).toBe(3);
        await registerLegacyScopeManifest(tx, f.operator, f.pin.manifest.id);
        const missing = f.pin.plan.proposals.find(
          (p) => p.cycleId === f.cycles[0].id && p.stage === 'TRANSPORT',
        )!.key;
        await confirmations(tx, f, missing);
        await expect(
          applyLegacyScopeRoot(
            tx,
            f.operator,
            f.pin.manifest.id,
            f.cycles[0].id,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(
          await tx.legacyScopeMapping.count({
            where: { manifestId: f.pin.manifest.id },
          }),
        ).toBe(0);
        await confirmLegacyScopeProposal(
          tx,
          f.transporter,
          f.pin.manifest.id,
          missing,
        );
        const first = await applyLegacyScopeRoot(
          tx,
          f.operator,
          f.pin.manifest.id,
          f.cycles[0].id,
        );
        expect(
          await applyLegacyScopeRoot(
            tx,
            f.operator,
            f.pin.manifest.id,
            f.cycles[0].id,
          ),
        ).toEqual(first);
        expect(await snapshot(tx, f)).toEqual(before);
        expect(
          await tx.eventChainContext.count({ where: { chainId: f.chain.id } }),
        ).toBe(4);
        expect(
          await tx.stageAssignment.count({ where: { chainId: f.chain.id } }),
        ).toBe(5);
        await tx.$executeRawUnsafe('SAVEPOINT incomplete_legacy_activation');
        let guardMessage = '';
        try {
          await tx.chainBusinessProfile.update({
            where: { chainId: f.chain.id },
            data: { state: 'ACTIVE', version: { increment: 1 } },
          });
        } catch (error) {
          guardMessage = JSON.stringify(error, (_key, value: unknown) =>
            value instanceof Error
              ? Object.fromEntries(
                  Object.getOwnPropertyNames(value).map((key) => [
                    key,
                    (value as unknown as Record<string, unknown>)[key],
                  ]),
                )
              : value,
          );
          await tx.$executeRawUnsafe(
            'ROLLBACK TO SAVEPOINT incomplete_legacy_activation',
          );
        }
        await tx.$executeRawUnsafe(
          'RELEASE SAVEPOINT incomplete_legacy_activation',
        );
        expect(guardMessage).toContain(
          'Legacy mapping incomplete before activation',
        );
        await applyLegacyScopeRoot(
          tx,
          f.operator,
          f.pin.manifest.id,
          f.cycles[1].id,
        );
        await tx.chainBusinessProfile.update({
          where: { chainId: f.chain.id },
          data: { state: 'ACTIVE', version: { increment: 1 } },
        });
        expect(await snapshot(tx, f)).toEqual(before);
        expect(
          await tx.eventChainContext.count({ where: { chainId: f.chain.id } }),
        ).toBe(6);
        expect(
          await tx.stageAssignment.count({ where: { chainId: f.chain.id } }),
        ).toBe(8);
      } finally {
        pins.restore();
      }
    }));

  it('rejects a changed reviewed history without a partial mapping or cutover marker', () =>
    scenario(async (tx) => {
      const f = await legacyHistoryFixture(tx, trace);
      const pins = installLegacyPin(f.pin);
      try {
        await registerLegacyScopeManifest(tx, f.operator, f.pin.manifest.id);
        await confirmations(tx, f);
        await tx.careRecord.create({
          data: {
            cycleId: f.cycles[0].id,
            careType: 'WATERING',
            eventTime: new Date(),
          },
        });
        await expect(
          applyLegacyScopeRoot(
            tx,
            f.operator,
            f.pin.manifest.id,
            f.cycles[0].id,
          ),
        ).rejects.toThrow('Root inventory đã đổi');
        expect(
          await tx.legacyScopeMapping.count({
            where: { manifestId: f.pin.manifest.id },
          }),
        ).toBe(0);
        expect(
          await tx.organizationBusinessScope.count({
            where: { organizationId: f.producer.organizationId! },
          }),
        ).toBe(0);
        expect(
          (
            await tx.productionCycle.findUniqueOrThrow({
              where: { id: f.cycles[0].id },
            })
          ).chainId,
        ).toBeNull();
      } finally {
        pins.restore();
      }
    }));
});

describe('Legacy apply through real JWT HTTP and concurrent transactions', () => {
  let app: INestApplication;
  let f: Fixture;
  let pins: ReturnType<typeof installLegacyPin>;
  let before: Awaited<ReturnType<typeof snapshot>>;
  const tokens = new Map<string, string>();
  const sessions = new Map<string, string>();
  let missing: string;
  const url = () => `/api/legacy-scope/manifests/${f.pin.manifest.id}`;
  const post = (
    suffix: string,
    actor: CommandActor,
    body = {},
    key: string = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post(url() + suffix)
      .set('Authorization', `Bearer ${tokens.get(actor.sub!)}`)
      .set('Idempotency-Key', key)
      .send(body);
  beforeAll(async () => {
    f = await db.$transaction((tx) => legacyHistoryFixture(tx, trace), {
      timeout: 20000,
    });
    pins = installLegacyPin(f.pin);
    before = await snapshot(db, f);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(serviceDb)
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...process.env,
          JWT_SECRET: 'isolated-legacy-http-only',
          FABRIC_ENABLED: 'false',
        }),
      )
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    for (const actor of [...f.actors, f.operator]) {
      const session = await db.refreshSession.create({
        data: {
          userId: actor.sub!,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      sessions.set(actor.sub!, session.id);
      tokens.set(
        actor.sub!,
        app.get(JwtService).sign({ sub: actor.sub, sid: session.id }),
      );
    }
  });
  afterAll(async () => {
    if (app) await app.close();
    if (pins) pins.restore();
    vi.restoreAllMocks();
  });

  it('keeps apply disabled by default, then registers only through the pinned current operator and replays its result journal', async () => {
    delete process.env.HYBRID_LEGACY_APPLY_ENABLED;
    await post('/register', f.operator).expect(403);
    expect(
      await db.legacyScopeManifestRecord.count({
        where: { id: f.pin.manifest.id },
      }),
    ).toBe(0);
    process.env.HYBRID_LEGACY_APPLY_ENABLED = '1';
    await request(app.getHttpServer())
      .get(url() + '/proposals')
      .expect(401);
    await post('/register', f.producer).expect(403);
    const key = randomUUID();
    const registered = await post('/register', f.operator, {}, key).expect(201);
    expect(
      (await post('/register', f.operator, {}, key).expect(201)).body.data,
    ).toEqual(registered.body.data);
    expect(
      await db.commandCommit.count({
        where: {
          requesterId: f.operator.sub!,
          operation: 'SCOPE_REGISTER_LEGACY_MANIFEST',
        },
      }),
    ).toBe(1);
  });

  it('projects only each party proposals and a scoped work link without private actor/grant/QR data', async () => {
    for (const actor of f.actors) {
      const response = await request(app.getHttpServer())
        .get(url() + '/proposals')
        .set('Authorization', `Bearer ${tokens.get(actor.sub!)}`)
        .expect(200);
      const expected =
        f.pin.plan.proposals.filter(
          (p) => p.organizationId === actor.organizationId,
        ).length + (actor === f.producer ? 1 : 0);
      expect(response.body.data).toHaveLength(expected);
      expect(JSON.stringify(response.body.data)).not.toMatch(
        /grantId|userId|passwordHash|traceToken|businessData|organizationId/,
      );
      expect(
        response.body.data.every(
          (p: { confirmationStatus: string }) =>
            p.confirmationStatus === 'PENDING',
        ),
      ).toBe(true);
      const context = await request(app.getHttpServer())
        .get('/api/supply-chains/context')
        .set('Authorization', `Bearer ${tokens.get(actor.sub!)}`)
        .expect(200);
      expect(context.body.data.legacyPendingManifests).toEqual([
        { manifestId: f.pin.manifest.id },
      ]);
    }
    expect(
      (
        await request(app.getHttpServer())
          .get(url() + '/proposals')
          .set('Authorization', `Bearer ${tokens.get(f.operator.sub!)}`)
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });

  it('requires owner and every stage confirmation; a different party and the operator cannot accept for a participant', async () => {
    const transport = f.pin.plan.proposals.find(
      (p) => p.cycleId === f.cycles[0].id && p.stage === 'TRANSPORT',
    )!;
    missing = transport.key;
    await post('/confirm', f.producer, { proposalKey: missing }).expect(403);
    await post('/confirm', f.operator, { proposalKey: missing }).expect(403);
    for (const key of Object.keys(legacyReviewKeys(f.pin)))
      await post('/confirm', f.producer, { proposalKey: key }).expect(201);
    for (const p of f.pin.plan.proposals) {
      if (p.key !== missing)
        await post(
          '/confirm',
          f.actors.find((a) => a.organizationId === p.organizationId)!,
          { proposalKey: p.key },
        ).expect(201);
    }
    const proposals = await request(app.getHttpServer())
      .get(url() + '/proposals')
      .set('Authorization', `Bearer ${tokens.get(f.transporter.sub!)}`)
      .expect(200);
    expect(
      proposals.body.data.filter(
        (p: { confirmationStatus: string }) =>
          p.confirmationStatus === 'PENDING',
      ),
    ).toHaveLength(1);
    expect(
      proposals.body.data.filter(
        (p: { confirmationStatus: string }) =>
          p.confirmationStatus === 'CONFIRMED',
      ),
    ).toHaveLength(2);
  });

  it('returns a deterministic conflict for missing consent with no journal/mapping and permits the party to finish that confirmation', async () => {
    const key = randomUUID();
    await post(`/roots/${f.cycles[0].id}/apply`, f.operator, {}, key).expect(
      409,
    );
    const record = await db.idempotencyRecord.findUniqueOrThrow({
      where: {
        requesterId_operation_idempotencyKey: {
          requesterId: f.operator.sub!,
          operation: 'SCOPE_APPLY_LEGACY_ROOT',
          idempotencyKey: key,
        },
      },
      include: { commandCommit: true },
    });
    expect(record.status).toBe('FAILED');
    expect(record.commandCommit).toBeNull();
    expect(
      await db.legacyScopeMapping.count({
        where: { manifestId: f.pin.manifest.id },
      }),
    ).toBe(0);
    await post('/confirm', f.transporter, { proposalKey: missing }).expect(201);
  });

  it('recovers a lost response after the real domain/journal commit with the original key and immutable history', async () => {
    const key = randomUUID();
    const completion = vi
      .spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(new Error('synthetic-response-lost-after-commit'));
    await post(`/roots/${f.cycles[0].id}/apply`, f.operator, {}, key).expect(
      500,
    );
    completion.mockRestore();
    const record = await db.idempotencyRecord.findUniqueOrThrow({
      where: {
        requesterId_operation_idempotencyKey: {
          requesterId: f.operator.sub!,
          operation: 'SCOPE_APPLY_LEGACY_ROOT',
          idempotencyKey: key,
        },
      },
      include: { commandCommit: true },
    });
    expect(record.status).toBe('PROCESSING');
    expect(record.commandCommit).not.toBeNull();
    const replay = await post(
      `/roots/${f.cycles[0].id}/apply`,
      f.operator,
      {},
      key,
    ).expect(201);
    expect(replay.body.data).toEqual(record.commandCommit!.responseBody);
    expect(
      await db.legacyScopeMapping.count({ where: { cycleId: f.cycles[0].id } }),
    ).toBe(1);
    expect(
      await db.eventChainContext.count({ where: { chainId: f.chain.id } }),
    ).toBe(4);
    expect(await snapshot(db, f)).toEqual(before);
  });

  it('serializes concurrent root apply, resumes the remaining root and activates only a complete mapping', async () => {
    const responses = await Promise.all([
      post(`/roots/${f.cycles[1].id}/apply`, f.operator).expect(201),
      post(`/roots/${f.cycles[1].id}/apply`, f.operator).expect(201),
    ]);
    expect(responses[0].body.data).toEqual(responses[1].body.data);
    expect(
      await db.legacyScopeMapping.count({
        where: { manifestId: f.pin.manifest.id },
      }),
    ).toBe(2);
    expect(
      await db.stageAssignment.count({ where: { chainId: f.chain.id } }),
    ).toBe(8);
    expect(
      await db.eventChainContext.count({ where: { chainId: f.chain.id } }),
    ).toBe(6);
    await db.chainBusinessProfile.update({
      where: { chainId: f.chain.id },
      data: { state: 'ACTIVE', version: { increment: 1 } },
    });
    expect(await snapshot(db, f)).toEqual(before);
  });

  it('checks current sessions before returning a stored apply response', async () => {
    const record = await db.idempotencyRecord.findFirstOrThrow({
      where: {
        requesterId: f.operator.sub!,
        operation: 'SCOPE_APPLY_LEGACY_ROOT',
        commandCommit: { isNot: null },
      },
    });
    await db.refreshSession.update({
      where: { id: sessions.get(f.operator.sub!)! },
      data: { revokedAt: new Date() },
    });
    const journal = await db.commandCommit.findUniqueOrThrow({
      where: { idempotencyRecordId: record.id },
    });
    const result = journal.responseBody as { cycleId: string };
    await post(
      `/roots/${result.cycleId}/apply`,
      f.operator,
      {},
      record.idempotencyKey,
    ).expect(401);
    expect(
      await db.commandCommit.findUniqueOrThrow({ where: { id: journal.id } }),
    ).toEqual(journal);
  });
});
