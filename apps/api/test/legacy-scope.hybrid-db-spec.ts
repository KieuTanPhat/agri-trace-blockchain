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
import {
  authorizeCommand,
  type CommandActor,
} from '../src/common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../src/common/crypto/rfc8785.js';
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import {
  applyLegacyScopeRoot,
  authorizeLegacyScopeCommand,
  confirmLegacyScopeProposal,
  legacyReviewKeys,
  registerLegacyScopeManifest,
} from '../src/modules/supply-chains/legacy-scope.commands.js';
import { inventoryLegacyScope } from '../src/modules/supply-chains/legacy-scope-inventory.js';
import { planLegacyScopeAssignments } from '../src/modules/supply-chains/legacy-scope-plan.js';
import type { LegacyScopePin } from '../src/modules/supply-chains/legacy-scope-pins.js';
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

async function reviewedReplacement(
  tx: Prisma.TransactionClient,
  f: Fixture,
  roots: string[],
  from?: LegacyScopePin,
): Promise<LegacyScopePin> {
  const inventory = await inventoryLegacyScope(tx);
  const own = new Set(roots);
  const manifest: LegacyScopePin['manifest'] = {
    ...f.pin.manifest,
    id: randomUUID(),
    schema: 'agritrace-legacy-scope-manifest-2',
    inventoryDigest: inventory.digest,
    entries: inventory.roots.map((r) => ({
      cycleId: r.cycleId,
      producerOrgId: r.producerOrgId,
      expectedVersion: r.version,
      inventoryDigest: r.inventoryDigest,
      decision: own.has(r.cycleId) ? 'MAP' : 'UNRESOLVED',
      chainId: own.has(r.cycleId) ? f.chain.id : null,
    })),
    supersedes: from
      ? roots
          .map((cycleId) => ({
            manifestId: from.manifest.id,
            manifestDigest: from.digest,
            cycleId,
          }))
          .sort((a, b) => a.cycleId.localeCompare(b.cycleId))
      : [],
  };
  const digest = canonicalSha256(manifest);
  return {
    manifest,
    digest,
    plan: await planLegacyScopeAssignments(tx, manifest, inventory, digest, {
      environment: manifest.environment,
      sourceSha: manifest.sourceSha,
    }),
  };
}

async function sqlGuard(
  tx: Prisma.TransactionClient,
  work: () => Promise<unknown>,
  message: string,
) {
  await tx.$executeRawUnsafe('SAVEPOINT expected_legacy_guard');
  let detail = '';
  try {
    await work();
  } catch (error) {
    detail = JSON.stringify(error, (_key, value: unknown) =>
      value instanceof Error
        ? Object.fromEntries(
            Object.getOwnPropertyNames(value).map((key) => [
              key,
              (value as unknown as Record<string, unknown>)[key],
            ]),
          )
        : value,
    );
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_legacy_guard');
  }
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT expected_legacy_guard');
  expect(detail).toContain(message);
}

beforeAll(async () => {
  expect(process.env.HYBRID_DRAFT_TESTS).toBe('1');
  expect(await db.lot.count({ where: { lotCode: 'scope-lot' } })).toBe(1);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('Legacy history preservation on isolated PostgreSQL', () => {
  it('resolves a previously UNRESOLVED checkpoint under fresh pinned review while preserving its old journal, hash and exact history', () =>
    scenario(async (tx) => {
      const f = await legacyHistoryFixture(tx, trace);
      f.pin = await reviewedReplacement(tx, f, []);
      const firstPins = installLegacyPin(f.pin);
      let replacementPins: ReturnType<typeof installLegacyPin> | undefined;
      try {
        const before = await snapshot(tx, f);
        await registerLegacyScopeManifest(tx, f.operator, f.pin.manifest.id);
        const old = await applyLegacyScopeRoot(
          tx,
          f.operator,
          f.pin.manifest.id,
          f.cycles[0].id,
        );
        expect(
          await tx.legacyScopeMapping.count({
            where: { cycleId: f.cycles[0].id },
          }),
        ).toBe(0);
        expect(
          await tx.legacyScopeCheckpoint.count({
            where: { manifestId: f.pin.manifest.id },
          }),
        ).toBe(1);
        const originalKey = randomUUID();
        const originalPayload = {
          manifestId: f.pin.manifest.id,
          cycleId: f.cycles[0].id,
        };
        const originalScope = canonicalSha256({
          protocol: 'legacy-scope-command-v1',
          manifestDigest: f.pin.digest,
          planDigest: f.pin.plan.digest,
          actor: f.operator.sub,
          operation: 'SCOPE_APPLY_LEGACY_ROOT',
        });
        const record = await tx.idempotencyRecord.create({
          data: {
            requesterId: f.operator.sub!,
            operation: 'SCOPE_APPLY_LEGACY_ROOT',
            requestType: 'COMMAND',
            idempotencyKey: originalKey,
            requestHash: canonicalSha256(originalPayload),
            authorizationScope: originalScope,
          },
        });
        const journal = await tx.commandCommit.create({
          data: {
            idempotencyRecordId: record.id,
            requesterId: f.operator.sub!,
            operation: record.operation,
            authorizationScope: originalScope,
            actorScope: { role: 'SYSTEM_ADMIN', organizationId: null },
            resourceIds: {},
            responseStatus: 201,
            responseBody: old,
          },
        });
        const replacement = await reviewedReplacement(
          tx,
          f,
          f.cycles.map((c) => c.id),
          f.pin,
        );
        replacementPins = installLegacyPin(f.pin, replacement);
        await registerLegacyScopeManifest(
          tx,
          f.operator,
          replacement.manifest.id,
        );
        await expect(
          applyLegacyScopeRoot(
            tx,
            f.operator,
            f.pin.manifest.id,
            f.cycles[0].id,
          ),
        ).rejects.toThrow('review đã được thay thế');
        await confirmations(tx, { ...f, pin: replacement });
        for (const cycle of f.cycles)
          await applyLegacyScopeRoot(
            tx,
            f.operator,
            replacement.manifest.id,
            cycle.id,
          );
        await tx.chainBusinessProfile.update({
          where: { chainId: f.chain.id },
          data: { state: 'ACTIVE', version: { increment: 1 } },
        });
        expect(await snapshot(tx, f)).toEqual(before);
        expect(
          await tx.legacyScopeCheckpoint.count({
            where: { cycleId: { in: f.cycles.map((c) => c.id) } },
          }),
        ).toBe(3);
        expect(
          await tx.commandCommit.findUnique({ where: { id: journal.id } }),
        ).toEqual(journal);
        expect(
          await authorizeLegacyScopeCommand(
            tx,
            {
              requesterId: f.operator.sub!,
              actor: f.operator,
              operation: record.operation,
              payload: originalPayload,
              idempotencyKey: originalKey,
            },
            true,
          ),
        ).toBe(originalScope);
        await sqlGuard(
          tx,
          () =>
            tx.legacyScopeCheckpoint.delete({
              where: {
                manifestId_cycleId: {
                  manifestId: f.pin.manifest.id,
                  cycleId: f.cycles[0].id,
                },
              },
            }),
          'legacy_scope_checkpoint is immutable',
        );
        await sqlGuard(
          tx,
          () =>
            tx.legacyScopeSupersession.delete({
              where: {
                fromManifestId_cycleId: {
                  fromManifestId: f.pin.manifest.id,
                  cycleId: f.cycles[0].id,
                },
              },
            }),
          'legacy_scope_supersession is immutable',
        );
      } finally {
        replacementPins?.restore();
        firstPins.restore();
      }
    }));

  it('re-reviews only the remaining root after a stale consent without replacing the already applied provenance', () =>
    scenario(async (tx) => {
      const f = await legacyHistoryFixture(tx, trace);
      const initialPins = installLegacyPin(f.pin);
      let replacementPins: ReturnType<typeof installLegacyPin> | undefined;
      try {
        const before = await snapshot(tx, f);
        await registerLegacyScopeManifest(tx, f.operator, f.pin.manifest.id);
        await confirmations(tx, f);
        const first = await applyLegacyScopeRoot(
          tx,
          f.operator,
          f.pin.manifest.id,
          f.cycles[0].id,
        );
        const grant = await tx.scopedRoleGrant.findFirstOrThrow({
          where: {
            userId: f.transporter.sub!,
            scope: 'ORGANIZATION',
            role: 'ORG_ADMIN',
            revokedAt: null,
          },
        });
        await tx.scopedRoleGrant.update({
          where: { id: grant.id },
          data: { revokedAt: new Date(), revision: { increment: 1 } },
        });
        await tx.scopedRoleGrant.create({
          data: {
            userId: f.transporter.sub!,
            organizationId: f.transporter.organizationId!,
            scope: 'ORGANIZATION',
            role: 'ORG_ADMIN',
          },
        });
        await expect(
          applyLegacyScopeRoot(
            tx,
            f.operator,
            f.pin.manifest.id,
            f.cycles[1].id,
          ),
        ).rejects.toThrow('Thiếu xác nhận hiện hành');
        const replacement = await reviewedReplacement(
          tx,
          f,
          [f.cycles[1].id],
          f.pin,
        );
        replacementPins = installLegacyPin(f.pin, replacement);
        await registerLegacyScopeManifest(
          tx,
          f.operator,
          replacement.manifest.id,
        );
        await confirmations(tx, { ...f, pin: replacement });
        await applyLegacyScopeRoot(
          tx,
          f.operator,
          replacement.manifest.id,
          f.cycles[1].id,
        );
        await tx.chainBusinessProfile.update({
          where: { chainId: f.chain.id },
          data: { state: 'ACTIVE', version: { increment: 1 } },
        });
        expect(
          await tx.legacyScopeMapping.findUnique({
            where: { cycleId: f.cycles[0].id },
            include: { checkpoint: true },
          }),
        ).toMatchObject({
          manifestId: f.pin.manifest.id,
          checkpoint: { checkpointDigest: first.checkpointDigest },
        });
        expect(
          await tx.legacyScopeSupersession.count({
            where: { fromManifestId: f.pin.manifest.id },
          }),
        ).toBe(1);
        expect(await snapshot(tx, f)).toEqual(before);
      } finally {
        replacementPins?.restore();
        initialPins.restore();
      }
    }));

  it('requires explicit pinned replacement of a changed history and keeps old consent artifacts rather than mutating them', () =>
    scenario(async (tx) => {
      const f = await legacyHistoryFixture(tx, trace);
      const initialPins = installLegacyPin(f.pin);
      let replacementPins: ReturnType<typeof installLegacyPin> | undefined;
      try {
        await registerLegacyScopeManifest(tx, f.operator, f.pin.manifest.id);
        await confirmations(tx, f);
        const consents = await tx.legacyScopeConsent.findMany({
          where: { manifestId: f.pin.manifest.id },
          orderBy: { id: 'asc' },
        });
        await tx.careRecord.create({
          data: {
            cycleId: f.cycles[0].id,
            careType: 'WATERING',
            eventTime: new Date(),
          },
        });
        const before = await snapshot(tx, f);
        const unreviewed = await reviewedReplacement(
          tx,
          f,
          f.cycles.map((c) => c.id),
        );
        replacementPins = installLegacyPin(f.pin, unreviewed);
        await expect(
          registerLegacyScopeManifest(tx, f.operator, unreviewed.manifest.id),
        ).rejects.toThrow('cần supersession được pin rõ');
        expect(
          await tx.legacyScopeManifestRecord.count({
            where: { id: unreviewed.manifest.id },
          }),
        ).toBe(0);
        replacementPins.restore();
        replacementPins = undefined;
        const replacement = await reviewedReplacement(
          tx,
          f,
          f.cycles.map((c) => c.id),
          f.pin,
        );
        replacementPins = installLegacyPin(f.pin, replacement);
        await registerLegacyScopeManifest(
          tx,
          f.operator,
          replacement.manifest.id,
        );
        await confirmations(tx, { ...f, pin: replacement });
        for (const cycle of f.cycles)
          await applyLegacyScopeRoot(
            tx,
            f.operator,
            replacement.manifest.id,
            cycle.id,
          );
        await tx.chainBusinessProfile.update({
          where: { chainId: f.chain.id },
          data: { state: 'ACTIVE', version: { increment: 1 } },
        });
        expect(await snapshot(tx, f)).toEqual(before);
        expect(
          await tx.legacyScopeConsent.findMany({
            where: { manifestId: f.pin.manifest.id },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(consents);
      } finally {
        replacementPins?.restore();
        initialPins.restore();
      }
    }));

  it.each(['PROCESSING', 'COMPLETED', 'FAILED'] as const)(
    'holds replacement for an old %s record without positive journal unless it is a known rejection',
    (status) =>
      scenario(async (tx) => {
        const f = await legacyHistoryFixture(tx, trace);
        const initialPins = installLegacyPin(f.pin);
        let replacementPins: ReturnType<typeof installLegacyPin> | undefined;
        try {
          await registerLegacyScopeManifest(tx, f.operator, f.pin.manifest.id);
          await tx.idempotencyRecord.create({
            data: {
              requesterId: f.operator.sub!,
              operation: 'SCOPE_APPLY_LEGACY_ROOT',
              requestType: 'COMMAND',
              idempotencyKey: randomUUID(),
              requestHash: canonicalSha256({
                manifestId: f.pin.manifest.id,
                cycleId: f.cycles[0].id,
              }),
              status,
              responseStatus:
                status === 'FAILED' ? 409 : status === 'COMPLETED' ? 201 : null,
              createdAt: new Date(Date.now() - 120000),
              expiresAt: new Date(Date.now() - 60000),
            },
          });
          const replacement = await reviewedReplacement(
            tx,
            f,
            f.cycles.map((c) => c.id),
            f.pin,
          );
          replacementPins = installLegacyPin(f.pin, replacement);
          if (status === 'FAILED')
            await registerLegacyScopeManifest(
              tx,
              f.operator,
              replacement.manifest.id,
            );
          else {
            await expect(
              registerLegacyScopeManifest(
                tx,
                f.operator,
                replacement.manifest.id,
              ),
            ).rejects.toThrow('Apply trước chưa rõ kết quả');
            expect(
              await tx.legacyScopeManifestRecord.count({
                where: { id: replacement.manifest.id },
              }),
            ).toBe(0);
            expect(
              await tx.legacyScopeSupersession.count({
                where: { fromManifestId: f.pin.manifest.id },
              }),
            ).toBe(0);
          }
          expect(
            await tx.legacyScopeMapping.count({
              where: { cycleId: { in: f.cycles.map((c) => c.id) } },
            }),
          ).toBe(0);
        } finally {
          replacementPins?.restore();
          initialPins.restore();
        }
      }),
  );

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
          'Active unresolved legacy root blocks activation',
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
  const inspect = (
    actor: CommandActor,
    operation: string,
    key: string,
    payload: object,
  ) =>
    request(app.getHttpServer())
      .post('/api/command-requests/status')
      .set('Authorization', `Bearer ${tokens.get(actor.sub!)}`)
      .set('Idempotency-Key', key)
      .send({ operation, payload });
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
        .get('/api/chain-permissions')
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

  it('inspects the immutable commit after a lost response and keeps an expired unknown request unresolved without changing its record', async () => {
    const record = await db.idempotencyRecord.findFirstOrThrow({
      where: {
        requesterId: f.operator.sub!,
        operation: 'SCOPE_APPLY_LEGACY_ROOT',
        commandCommit: { isNot: null },
      },
      include: { commandCommit: true },
    });
    const payload = { manifestId: f.pin.manifest.id, cycleId: f.cycles[0].id };
    const committed = await inspect(
      f.operator,
      record.operation,
      record.idempotencyKey,
      payload,
    ).expect(200);
    expect(committed.body.data).toEqual({
      status: 'COMMITTED',
      responseStatus: 201,
      result: record.commandCommit!.responseBody,
    });
    const input = {
      actor: { ...f.operator, sid: sessions.get(f.operator.sub!) },
      requesterId: f.operator.sub!,
      operation: record.operation,
      idempotencyKey: randomUUID(),
      payload: { ...payload, cycleId: f.cycles[1].id },
    };
    const scope = await authorizeCommand(db, input);
    const unknown = await db.idempotencyRecord.create({
      data: {
        requesterId: input.requesterId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        requestType: 'COMMAND',
        requestHash: canonicalSha256(input.payload),
        authorizationScope: scope,
        status: 'PROCESSING',
        createdAt: new Date(Date.now() - 60000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      (
        await inspect(
          f.operator,
          input.operation,
          input.idempotencyKey,
          input.payload,
        ).expect(200)
      ).body.data,
    ).toEqual({ status: 'RECONCILIATION_REQUIRED' });
    expect(
      await db.idempotencyRecord.findUniqueOrThrow({
        where: { id: unknown.id },
      }),
    ).toEqual(unknown);
    expect(
      await db.commandCommit.count({
        where: { idempotencyRecordId: unknown.id },
      }),
    ).toBe(0);
    expect(
      await db.legacyScopeMapping.count({ where: { cycleId: f.cycles[1].id } }),
    ).toBe(0);
    expect(
      (
        await inspect(
          f.operator,
          input.operation,
          randomUUID(),
          input.payload,
        ).expect(200)
      ).body.data,
    ).toEqual({ status: 'NOT_FOUND' });
  });

  it('does not disclose an inspected result to another party or a changed payload and distinguishes a known rejection', async () => {
    const positive = await db.idempotencyRecord.findFirstOrThrow({
      where: {
        requesterId: f.operator.sub!,
        operation: 'SCOPE_APPLY_LEGACY_ROOT',
        commandCommit: { isNot: null },
      },
    });
    const payload = { manifestId: f.pin.manifest.id, cycleId: f.cycles[0].id };
    await inspect(
      f.transporter,
      positive.operation,
      positive.idempotencyKey,
      payload,
    ).expect(403);
    await inspect(f.operator, positive.operation, positive.idempotencyKey, {
      ...payload,
      cycleId: f.cycles[1].id,
    }).expect(409);
    const rejected = await db.idempotencyRecord.findFirstOrThrow({
      where: {
        requesterId: f.operator.sub!,
        operation: positive.operation,
        status: 'FAILED',
      },
    });
    const response = await inspect(
      f.operator,
      rejected.operation,
      rejected.idempotencyKey,
      payload,
    ).expect(200);
    expect(response.body.data.status).toBe('REJECTED');
    expect(response.body.data.responseStatus).toBe(409);
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

  it('reconciles a committed consent after activation using its original key, while closing fresh and regranted consent', async () => {
    const record = await db.idempotencyRecord.findFirstOrThrow({
      where: {
        requesterId: f.transporter.sub!,
        operation: 'SCOPE_CONFIRM_LEGACY_ASSIGNMENT',
        commandCommit: { isNot: null },
      },
      include: { commandCommit: true },
    });
    const result = record.commandCommit!.responseBody as {
      proposalKey: string;
    };
    expect(
      (
        await post(
          '/confirm',
          f.transporter,
          { proposalKey: result.proposalKey },
          record.idempotencyKey,
        ).expect(201)
      ).body.data,
    ).toEqual(result);
    expect(
      (
        await inspect(f.transporter, record.operation, record.idempotencyKey, {
          manifestId: f.pin.manifest.id,
          proposalKey: result.proposalKey,
        }).expect(200)
      ).body.data.status,
    ).toBe('COMMITTED');
    await post('/confirm', f.transporter, {
      proposalKey: result.proposalKey,
    }).expect(403);
    expect(
      (
        await request(app.getHttpServer())
          .get(url() + '/proposals')
          .set('Authorization', `Bearer ${tokens.get(f.transporter.sub!)}`)
          .expect(200)
      ).body.data,
    ).toEqual([]);
    const consent = await db.legacyScopeConsent.findUniqueOrThrow({
      where: {
        manifestId_proposalKey: {
          manifestId: f.pin.manifest.id,
          proposalKey: result.proposalKey,
        },
      },
    });
    await db.scopedRoleGrant.update({
      where: { id: consent.grantId },
      data: { revokedAt: new Date(), revision: { increment: 1 } },
    });
    await db.scopedRoleGrant.create({
      data: {
        userId: f.transporter.sub!,
        organizationId: f.transporter.organizationId!,
        scope: 'ORGANIZATION',
        role: 'ORG_ADMIN',
      },
    });
    await post(
      '/confirm',
      f.transporter,
      { proposalKey: result.proposalKey },
      record.idempotencyKey,
    ).expect(409);
    expect(
      await db.legacyScopeConsent.findUniqueOrThrow({
        where: { id: consent.id },
      }),
    ).toEqual(consent);
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
