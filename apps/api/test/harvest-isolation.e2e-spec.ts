import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { LotHarvestService } from '../src/modules/lots/lot-harvest.service.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import { provisionChain } from './support/chain-scope.js';

// AGT-014: real HTTP/PostgreSQL, with the synthetic ledger route from E2E setup.
// Pending outbox rows prove atomic enqueueing, not delivery to a live Fabric.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

type HarvestBody = {
  quantity: number;
  unit: string;
  harvestTime: string;
  lotCode?: string;
};

type HarvestResult = {
  harvest: { id: string; cycleId: string };
  lot: { id: string; lotCode: string; harvestId: string };
  traceQr: { id: string; lotId: string; traceToken: string; traceUrl: string };
  cycleVersion: number;
};

const plantedAt = '2026-09-25T00:00:00.000Z';
const firstCutoff = '2026-09-26T00:00:00.000Z';
const secondCutoff = '2026-09-27T00:00:00.000Z';

describe('AGT-014: independent harvests, Lots and QR codes', () => {
  let app: INestApplication;
  let token: string;
  let farmId: string;
  let farmOrgId: string;
  let productId: string;
  let chainId: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const organization = await prisma.organization.create({
      data: { name: `AGT-014 ${randomUUID()}`, type: 'FARM' },
    });
    farmOrgId = organization.id;
    farmId = (
      await prisma.farm.create({
        data: { name: 'AGT-014 farm', organizationId: farmOrgId },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: { productName: 'AGT-014 vegetables', defaultUnit: 'kg' },
      })
    ).id;
    const role = await prisma.role.upsert({
      where: { code: 'FARM_STAFF' },
      create: { code: 'FARM_STAFF', name: 'Farm staff' },
      update: {},
    });
    userId = (
      await prisma.user.create({
        data: {
          email: `agt014-${randomUUID()}@example.test`,
          fullName: 'AGT-014 farmer',
          roleId: role.id,
          organizationId: farmOrgId,
          passwordHash: 'not-a-login-fixture',
        },
      })
    ).id;
    const sessionId = randomUUID();
    await prisma.refreshSession.create({
      data: {
        id: sessionId,
        familyId: sessionId,
        userId,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    chainId = await provisionChain(prisma, {
      name: 'AGT-014 harvest chain',
      ownerOrganizationId: farmOrgId,
      memberOrganizationIds: [],
      grants: (['ORG_ADMIN', 'CHAIN_MANAGER', 'FARM_STAFF'] as const).map(
        (code) => ({
          userId,
          organizationId: farmOrgId,
          role: code,
        }),
      ),
    });

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'agt014-tests-only-secret',
        get: (_key: string, fallback: unknown) => fallback,
      })
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
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();
    token = app.get(JwtService).sign({ sub: userId, sid: sessionId });
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  function post(path: string, body: object, key = randomUUID()) {
    return request(app.getHttpServer())
      .post('/api' + path)
      .set('Authorization', 'Bearer ' + token)
      .set('Idempotency-Key', key)
      .send(body);
  }

  async function plantedCycle(maxHarvestQuantity = 1) {
    const created = await post('/production-cycles', {
      chainId,
      farmId,
      productId,
      cycleCode: 'AGT014-' + randomUUID(),
      maxHarvestQuantity,
      harvestUnit: 'kg',
    }).expect(201);
    const id: string = created.body.data.id;
    await post(`/production-cycles/${id}/plant`, {
      version: 0,
      plantedAt,
    }).expect(201);
    return id;
  }

  function harvest(cycleId: string, body: HarvestBody, key = randomUUID()) {
    return post(`/production-cycles/${cycleId}/harvests`, body, key);
  }

  async function snapshot(cycleId: string) {
    const lotScope = { harvest: { cycleId } };
    const [cycle, harvests, lots, qrs, windows, movements, events, outbox] =
      await Promise.all([
        prisma.productionCycle.findUniqueOrThrow({
          where: { id: cycleId },
          select: { currentState: true, version: true },
        }),
        prisma.harvestEvent.findMany({
          where: { cycleId },
          orderBy: { id: 'asc' },
        }),
        prisma.lot.findMany({ where: lotScope, orderBy: { id: 'asc' } }),
        prisma.traceQr.findMany({
          where: { lot: lotScope },
          orderBy: { id: 'asc' },
        }),
        prisma.harvestSensorWindow.findMany({
          where: { cycleId },
          orderBy: { id: 'asc' },
        }),
        prisma.quantityMovement.findMany({
          where: { lot: lotScope },
          orderBy: { id: 'asc' },
        }),
        prisma.traceEvent.findMany({
          where: { cycleId },
          orderBy: { id: 'asc' },
        }),
        prisma.blockchainOutbox.findMany({
          where: { traceEvent: { cycleId } },
          orderBy: { id: 'asc' },
        }),
      ]);
    return { cycle, harvests, lots, qrs, windows, movements, events, outbox };
  }

  async function expectNoCommit(key: string) {
    const record = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { requesterId: userId, idempotencyKey: key },
    });
    expect(
      await prisma.commandCommit.count({
        where: { idempotencyRecordId: record.id },
      }),
    ).toBe(0);
  }

  it('creates one Harvest/Lot/QR per harvest, inherits origin and keeps the cycle open at its exact Decimal limit', async () => {
    const cycleId = await plantedCycle(0.3);
    const results: HarvestResult[] = [];
    for (const [quantity, harvestTime] of [
      [0.1, firstCutoff],
      [0.2, secondCutoff],
    ] as const) {
      results.push(
        (
          await harvest(cycleId, { quantity, unit: 'kg', harvestTime }).expect(
            201,
          )
        ).body.data,
      );
    }
    for (const values of [
      results.map((value) => value.harvest.id),
      results.map((value) => value.lot.id),
      results.map((value) => value.lot.lotCode),
      results.map((value) => value.traceQr.id),
      results.map((value) => value.traceQr.traceToken),
    ])
      expect(new Set(values).size).toBe(2);

    const stored = await snapshot(cycleId);
    expect(stored.cycle).toEqual({ currentState: 'PLANTED', version: 3 });
    for (const rows of [
      stored.harvests,
      stored.lots,
      stored.qrs,
      stored.windows,
      stored.movements,
    ])
      expect(rows).toHaveLength(2);
    expect(results.map((result) => result.cycleVersion)).toEqual([2, 3]);
    const total = await prisma.harvestEvent.aggregate({
      where: { cycleId },
      _sum: { quantity: true },
    });
    expect(total._sum.quantity?.toString()).toBe('0.3');

    for (const result of results) {
      const lot = stored.lots.find((row) => row.id === result.lot.id)!;
      const ownHarvest = stored.harvests.find(
        (row) => row.id === result.harvest.id,
      )!;
      expect(lot).toMatchObject({
        harvestId: ownHarvest.id,
        productId,
        farmOrgId,
        unit: 'kg',
      });
      expect(lot.initialQuantity.equals(ownHarvest.quantity)).toBe(true);
      expect(lot.availableQuantity.equals(ownHarvest.quantity)).toBe(true);
      expect(result.traceQr).toMatchObject({ lotId: lot.id });
      expect(
        result.traceQr.traceUrl.endsWith('/' + result.traceQr.traceToken),
      ).toBe(true);
      expect(
        stored.windows.find((row) => row.harvestId === ownHarvest.id),
      ).toMatchObject({
        cycleId,
        status: 'NO_DATA',
        readingCount: 0,
        digestHash: null,
      });
      const ownMovements = stored.movements.filter(
        (row) => row.lotId === lot.id,
      );
      expect(ownMovements).toHaveLength(1);
      expect(ownMovements[0].type).toBe('HARVEST_IN');
      expect(ownMovements[0].beforeQty.isZero()).toBe(true);
      expect(ownMovements[0].afterQty.equals(ownHarvest.quantity)).toBe(true);
      const ownEvents = stored.events.filter((row) => row.lotId === lot.id);
      expect(ownEvents.map((row) => row.eventType).sort()).toEqual([
        'HARVEST_RECORDED',
        'SENSOR_DIGEST_FINALIZED',
      ]);
      for (const event of ownEvents) {
        const jobs = stored.outbox.filter((row) => row.eventId === event.id);
        expect(jobs).toHaveLength(1);
        expect(jobs[0].status).toBe('PENDING');
      }
    }
  });

  it('resolves both QR tokens to separate timelines while sharing the same cycle events', async () => {
    const cycleId = await plantedCycle(2);
    const first: HarvestResult = (
      await harvest(cycleId, {
        quantity: 0.5,
        unit: 'kg',
        harvestTime: firstCutoff,
      }).expect(201)
    ).body.data;
    const second: HarvestResult = (
      await harvest(cycleId, {
        quantity: 0.5,
        unit: 'kg',
        harvestTime: secondCutoff,
      }).expect(201)
    ).body.data;
    expect(first.traceQr.traceToken).not.toBe(second.traceQr.traceToken);
    const common = await prisma.traceEvent.findMany({
      where: { cycleId, lotId: null },
    });
    expect(common.length).toBeGreaterThan(0);
    for (const [own, sibling] of [
      [first, second],
      [second, first],
    ]) {
      const ownEvents = await prisma.traceEvent.findMany({
        where: { lotId: own.lot.id },
      });
      const siblingEvents = await prisma.traceEvent.findMany({
        where: { lotId: sibling.lot.id },
      });
      const internal = await request(app.getHttpServer())
        .get('/api/lots/' + own.lot.id)
        .set('Authorization', 'Bearer ' + token)
        .expect(200);
      const publicTrace = await request(app.getHttpServer())
        .get('/api/public/trace/' + own.traceQr.traceToken)
        .expect(200);
      for (const projection of [internal.body.data, publicTrace.body.data]) {
        expect(projection.lotCode).toBe(own.lot.lotCode);
        const ids = projection.timeline.map(
          (event: { eventId: string }) => event.eventId,
        );
        expect(ids).toHaveLength(common.length + ownEvents.length);
        expect(new Set(ids).size).toBe(ids.length);
        for (const event of [...common, ...ownEvents])
          expect(ids).toContain(event.id);
        for (const event of siblingEvents) expect(ids).not.toContain(event.id);
      }
    }
  });

  it('allows another harvest in GROWING without completing the cycle', async () => {
    const cycleId = await plantedCycle(1);
    await harvest(cycleId, {
      quantity: 0.5,
      unit: 'kg',
      harvestTime: firstCutoff,
    }).expect(201);
    await post(`/production-cycles/${cycleId}/care`, {
      version: 2,
      careType: 'WATERING',
      eventTime: '2026-09-26T12:00:00.000Z',
    }).expect(201);
    await harvest(cycleId, {
      quantity: 0.5,
      unit: 'kg',
      harvestTime: secondCutoff,
    }).expect(201);
    const stored = await snapshot(cycleId);
    expect(stored.harvests).toHaveLength(2);
    expect(stored.cycle).toEqual({
      currentState: 'GROWING',
      version: 4,
    });
  });

  it.each([
    ['COMPLETED', 'close'],
    ['CANCELLED', 'cancel'],
  ] as const)(
    'rejects harvest in %s without changing domain data, events or outbox',
    async (state, command) => {
      const cycleId = await plantedCycle();
      await harvest(cycleId, {
        quantity: 0.1,
        unit: 'kg',
        harvestTime: firstCutoff,
      }).expect(201);
      await post(`/production-cycles/${cycleId}/${command}`, {
        version: 2,
        ...(command === 'cancel'
          ? { reason: 'AGT-014 terminal cycle check' }
          : {}),
      }).expect(201);
      const before = await snapshot(cycleId);
      expect(before.cycle.currentState).toBe(state);
      expect(before.harvests).toHaveLength(1);
      const key = randomUUID();
      await harvest(
        cycleId,
        { quantity: 0.1, unit: 'kg', harvestTime: secondCutoff },
        key,
      ).expect(409);
      expect(await snapshot(cycleId)).toEqual(before);
      await expectNoCommit(key);
    },
  );

  it('replays the same key with identical Harvest/Lot/QR and creates only one journal entry', async () => {
    const cycleId = await plantedCycle();
    const body = { quantity: 0.5, unit: 'kg', harvestTime: firstCutoff };
    const key = randomUUID();
    const first = await harvest(cycleId, body, key).expect(201);
    const before = await snapshot(cycleId);
    const replay = await harvest(cycleId, body, key).expect(201);
    expect(replay.body.data).toEqual(first.body.data);
    expect(await snapshot(cycleId)).toEqual(before);
    await harvest(cycleId, { ...body, quantity: 0.6 }, key).expect(409);
    expect(await snapshot(cycleId)).toEqual(before);
    const record = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { requesterId: userId, idempotencyKey: key },
    });
    expect(
      await prisma.commandCommit.count({
        where: { idempotencyRecordId: record.id },
      }),
    ).toBe(1);
    const journal = await prisma.commandCommit.findUniqueOrThrow({
      where: { idempotencyRecordId: record.id },
    });
    expect(journal.responseBody).toEqual(first.body.data);
  });

  it('does not duplicate a harvest when the same key arrives concurrently', async () => {
    const cycleId = await plantedCycle();
    const body = { quantity: 0.5, unit: 'kg', harvestTime: firstCutoff };
    const key = randomUUID();
    const responses = await Promise.all([
      harvest(cycleId, body, key),
      harvest(cycleId, body, key),
    ]);
    expect(responses.some((response) => response.status === 201)).toBe(true);
    for (const response of responses)
      expect([201, 409]).toContain(response.status);
    const committed = responses.find((response) => response.status === 201)!;
    const replay = await harvest(cycleId, body, key).expect(201);
    expect(replay.body.data).toEqual(committed.body.data);
    const stored = await snapshot(cycleId);
    for (const rows of [
      stored.harvests,
      stored.lots,
      stored.qrs,
      stored.windows,
      stored.movements,
    ])
      expect(rows).toHaveLength(1);
    expect(stored.cycle.version).toBe(2);
  });

  it('rejects a later harvest exceeding the accumulated Decimal limit without partial writes', async () => {
    const cycleId = await plantedCycle(0.3);
    await harvest(cycleId, {
      quantity: 0.1,
      unit: 'kg',
      harvestTime: firstCutoff,
    }).expect(201);
    const before = await snapshot(cycleId);
    const key = randomUUID();
    const rejected = await harvest(
      cycleId,
      { quantity: 0.201, unit: 'kg', harvestTime: secondCutoff },
      key,
    ).expect(422);
    expect(rejected.body.error.message).toContain(
      'Tổng sản lượng thu hoạch vượt giới hạn',
    );
    expect(await snapshot(cycleId)).toEqual(before);
    await expectNoCommit(key);
  });

  it('serializes two in-flight harvests with increasing cutoffs before checking their total', async () => {
    const cycleId = await plantedCycle(1);
    const service = app.get(LotHarvestService);
    const entered = vi.spyOn(service, 'recordHarvest');
    const trace = app.get(TraceService);
    const original = trace.createInTransaction.bind(trace);
    let firstIsHoldingLock = false;
    let releaseFirst!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.spyOn(trace, 'createInTransaction').mockImplementation(
      async (tx, input) => {
        if (
          input.cycleId === cycleId &&
          input.eventType === 'HARVEST_RECORDED' &&
          !firstIsHoldingLock
        ) {
          firstIsHoldingLock = true;
          await barrier;
        }
        return original(tx, input);
      },
    );
    const first = harvest(cycleId, {
      quantity: 0.6,
      unit: 'kg',
      harvestTime: firstCutoff,
    }).then((value) => value);
    const running = [first];
    try {
      await expect.poll(() => firstIsHoldingLock, { timeout: 5000 }).toBe(true);
      const second = harvest(cycleId, {
        quantity: 0.6,
        unit: 'kg',
        harvestTime: secondCutoff,
      }).then((value) => value);
      running.push(second);
      await expect
        .poll(() => entered.mock.calls.length, { timeout: 5000 })
        .toBe(2);
      releaseFirst();
      const [accepted, rejected] = await Promise.all([first, second]);
      expect(accepted.status).toBe(201);
      expect(rejected.status).toBe(422);
      // A cutoff error would not prove that the quantity guard was exercised.
      expect(rejected.body.error.message).toContain(
        'Tổng sản lượng thu hoạch vượt giới hạn',
      );
      const stored = await snapshot(cycleId);
      expect(stored.harvests).toHaveLength(1);
      expect(stored.harvests[0].quantity.toString()).toBe('0.6');
      for (const rows of [
        stored.lots,
        stored.qrs,
        stored.windows,
        stored.movements,
      ])
        expect(rows).toHaveLength(1);
      expect(stored.cycle.version).toBe(2);
    } finally {
      releaseFirst();
      await Promise.allSettled(running);
    }
  });

  it('rejects a duplicate lotCode and rolls back the second harvest', async () => {
    const cycleId = await plantedCycle(2);
    const lotCode = 'AGT014-' + randomUUID();
    await harvest(cycleId, {
      quantity: 0.5,
      unit: 'kg',
      harvestTime: firstCutoff,
      lotCode,
    }).expect(201);
    const before = await snapshot(cycleId);
    const key = randomUUID();
    await harvest(
      cycleId,
      { quantity: 0.5, unit: 'kg', harvestTime: secondCutoff, lotCode },
      key,
    ).expect(409);
    expect(await snapshot(cycleId)).toEqual(before);
    await expectNoCommit(key);
  });

  it('rejects a different unit without changing the existing harvest', async () => {
    const cycleId = await plantedCycle(2);
    await harvest(cycleId, {
      quantity: 0.5,
      unit: 'kg',
      harvestTime: firstCutoff,
    }).expect(201);
    const before = await snapshot(cycleId);
    const key = randomUUID();
    await harvest(
      cycleId,
      { quantity: 0.5, unit: 'g', harvestTime: secondCutoff },
      key,
    ).expect(422);
    expect(await snapshot(cycleId)).toEqual(before);
    await expectNoCommit(key);
  });

  it.each([0, -1, 0.0001])(
    'rejects invalid quantity %s before creating a harvest',
    async (quantity) => {
      const cycleId = await plantedCycle();
      const before = await snapshot(cycleId);
      await harvest(cycleId, {
        quantity,
        unit: 'kg',
        harvestTime: firstCutoff,
      }).expect(400);
      expect(await snapshot(cycleId)).toEqual(before);
    },
  );

  it('rolls back all harvest writes when the second trace fails after the first outbox insert', async () => {
    const cycleId = await plantedCycle();
    const before = await snapshot(cycleId);
    const trace = app.get(TraceService);
    const original = trace.createInTransaction.bind(trace);
    let queuedBeforeFailure = 0;
    vi.spyOn(trace, 'createInTransaction')
      .mockImplementationOnce(original)
      .mockImplementationOnce(async (tx, input) => {
        queuedBeforeFailure = await tx.blockchainOutbox.count({
          where: { traceEvent: { cycleId, lotId: input.lotId } },
        });
        throw new Error('AGT-014 injected second-trace failure');
      });
    const key = randomUUID();
    await harvest(
      cycleId,
      { quantity: 0.5, unit: 'kg', harvestTime: firstCutoff },
      key,
    ).expect(500);
    expect(queuedBeforeFailure).toBe(1);
    expect(await snapshot(cycleId)).toEqual(before);
    await expectNoCommit(key);
  });
});
