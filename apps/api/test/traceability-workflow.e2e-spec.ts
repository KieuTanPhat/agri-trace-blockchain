import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import { LotHarvestService } from '../src/modules/lots/lot-harvest.service.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { canonicalSha256 } from '../src/common/crypto/rfc8785.js';

const connectionString = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      connectionString ?? 'postgresql://unused@localhost/unused',
  }),
});

(connectionString ? describe : describe.skip)(
  'Real PostgreSQL traceability workflows',
  () => {
    let app: INestApplication;
    let jwt: JwtService;
    let farmId: string;
    let productId: string;
    let farmOrgId: string;
    let transporterOrgId: string;
    let retailerOrgId: string;
    const users: Record<string, string> = {};
    const sessionIds: Record<string, string> = {};

    beforeAll(async () => {
      await prisma.$queryRaw`SELECT 1`;
      const organization = async (
        type: 'FARM' | 'TRANSPORTER' | 'RETAILER' | 'AUDITOR',
      ) =>
        prisma.organization.create({
          data: { name: `Workflow ${type} ${randomUUID()}`, type },
        });
      const farmOrg = await organization('FARM');
      const transporter = await organization('TRANSPORTER');
      const retailer = await organization('RETAILER');
      const foreignFarm = await organization('FARM');
      const reviewerOrg = await organization('AUDITOR');
      farmOrgId = farmOrg.id;
      transporterOrgId = transporter.id;
      retailerOrgId = retailer.id;
      farmId = (
        await prisma.farm.create({
          data: { organizationId: farmOrg.id, name: 'Workflow farm' },
        })
      ).id;
      productId = (
        await prisma.product.create({
          data: { productName: 'Workflow vegetables', defaultUnit: 'kg' },
        })
      ).id;
      for (const [name, code, org] of [
        ['farm', 'FARM_STAFF', farmOrg.id],
        ['foreign', 'FARM_STAFF', foreignFarm.id],
        ['transporter', 'TRANSPORTER', transporter.id],
        ['retailer', 'RETAILER', retailer.id],
        ['admin', 'SYSTEM_ADMIN', null],
        ['auditor', 'AUDITOR', null],
        ['reviewer', 'COMPLIANCE_REVIEWER', reviewerOrg.id],
        ['unscoped', 'FARM_STAFF', null],
      ] as const) {
        const role = await prisma.role.upsert({
          where: { code },
          create: { code, name: code },
          update: {},
        });
        users[name] = (
          await prisma.user.create({
            data: {
              fullName: `Workflow ${name}`,
              email: `workflow-${randomUUID()}@example.test`,
              roleId: role.id,
              organizationId: org,
              passwordHash: 'not-a-login-fixture',
            },
          })
        ).id;
        sessionIds[name] = randomUUID();
        await prisma.refreshSession.create({
          data: {
            id: sessionIds[name],
            familyId: sessionIds[name],
            userId: users[name],
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
      }
      const fixture = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(ConfigService)
        .useValue({
          getOrThrow: () => 'workflow-tests-only-secret',
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
      await post(
        '/compliance/assignments',
        {
          reviewerUserId: users.reviewer,
          farmId,
          reason: 'Authorize the existing compliance workflow fixtures',
        },
        'admin',
      ).expect(201);
    }, 30_000);

    afterAll(async () => {
      await app?.close();
      await prisma.$disconnect();
    });

    afterEach(() => vi.restoreAllMocks());

    function bearer(user: string) {
      return 'Bearer ' + jwt.sign({ sub: users[user], sid: sessionIds[user] });
    }

    function get(path: string, user = 'farm') {
      return request(app.getHttpServer())
        .get('/api' + path)
        .set('Authorization', bearer(user));
    }
    function post(
      path: string,
      body: object,
      user = 'farm',
      key = randomUUID(),
    ) {
      return request(app.getHttpServer())
        .post('/api' + path)
        .set('Authorization', bearer(user))
        .set('Idempotency-Key', key)
        .send(body);
    }
    async function plantedCycle(quantity = 1) {
      const created = await post('/production-cycles', {
        farmId,
        productId,
        cycleCode: 'CYCLE-' + randomUUID(),
        maxHarvestQuantity: quantity,
        harvestUnit: 'kg',
      }).expect(201);
      const cycle = created.body.data;
      await post(`/production-cycles/${cycle.id}/plant`, {
        version: 0,
        plantedAt: '2026-09-25T00:00:00.000Z',
      }).expect(201);
      return cycle;
    }
    async function harvestedLot(quantity = 1) {
      const cycle = await plantedCycle(quantity);
      const result = await post(`/production-cycles/${cycle.id}/harvests`, {
        quantity,
        unit: 'kg',
        harvestTime: '2026-09-26T00:00:00.000Z',
      }).expect(201);
      return { cycle, ...result.body.data };
    }
    async function startedShipment(quantity = 1) {
      const fixture = await harvestedLot(quantity);
      const created = await post('/shipments', {
        lotId: fixture.lot.id,
        transporterOrgId,
        retailerOrgId,
        origin: 'Farm',
        destination: 'Retailer',
      }).expect(201);
      const shipment = created.body.data;
      await post(
        `/shipments/${shipment.id}/start`,
        { version: 0, lotVersion: 0 },
        'transporter',
      ).expect(201);
      return { ...fixture, shipment };
    }

    async function deliveredLot(quantity = 1) {
      const fixture = await startedShipment(quantity);
      await post(
        `/shipments/${fixture.shipment.id}/arrive`,
        {
          version: 1,
          lotVersion: 1,
        },
        'transporter',
      ).expect(201);
      await post(
        `/shipments/${fixture.shipment.id}/receive`,
        {
          version: 2,
          lotVersion: 2,
          receivedQuantity: quantity,
        },
        'retailer',
      ).expect(201);
      return fixture;
    }

    it('keeps a linear hash chain when business timestamps are backdated or tied', async () => {
      const db = prisma as unknown as PrismaService;
      const trace = new TraceService(db, new OrganizationAccessService(db));
      const entityId = randomUUID();
      const events = [];
      for (const eventTime of ['2026-09-28', '2026-09-25', '2026-09-25']) {
        events.push(
          await prisma.$transaction((tx) =>
            trace.createInTransaction(tx, {
              entityType: 'LOT',
              entityId,
              eventType: 'TEST_CHECKPOINT',
              eventTime: new Date(eventTime),
              actor: { sub: null, organizationId: null, role: 'SYSTEM_ACTOR' },
              businessData: { sequence: events.length },
            }),
          ),
        );
      }
      expect(events[0].previousEventHash).toBeNull();
      expect(events[1].previousEventHash).toBe(events[0].dataHash);
      expect(events[2].previousEventHash).toBe(events[1].dataHash);
      expect(
        await prisma.blockchainOutbox.count({
          where: { eventId: { in: events.map((e) => e.id) } },
        }),
      ).toBe(3);
    });

    it('completes harvest, transport, partial damage and receipt with exact quantities', async () => {
      const { lot, shipment, traceQr, cycle } = await startedShipment(0.5);
      await post(
        `/shipments/${shipment.id}/damage`,
        { version: 1, lotVersion: 1, quantity: 0.1, reason: 'Transit damage' },
        'transporter',
      ).expect(201);
      await post(
        `/shipments/${shipment.id}/arrive`,
        { version: 2, lotVersion: 2 },
        'transporter',
      ).expect(201);
      await post(
        `/shipments/${shipment.id}/receive`,
        {
          version: 3,
          lotVersion: 3,
          receivedQuantity: 0.3,
          damagedQuantity: 0.1,
        },
        'retailer',
      ).expect(201);
      const detail = (await get(`/lots/${lot.id}`, 'retailer').expect(200)).body
        .data;
      expect(detail.currentState).toBe('RETAIL_RECEIVED');
      expect(detail.availableQuantity).toBe(0.3);
      expect(detail.damagedQuantity).toBe(0.2);
      expect(detail.shipment.receivedQuantity).toBe(0.3);
      expect(detail.shipment.rejectedQuantity).toBe(0);
      const publicTrace = await request(app.getHttpServer())
        .get('/api/public/trace/' + traceQr.traceToken)
        .expect(200);
      expect(publicTrace.body.data.lotId).toBe(lot.id);
      expect(
        await prisma.blockchainOutbox.count({
          where: {
            traceEvent: { OR: [{ lotId: lot.id }, { cycleId: cycle.id }] },
          },
        }),
      ).toBeGreaterThan(4);
    });

    it('rejects stale versions without changing quantities or appending events', async () => {
      const { lot, shipment } = await startedShipment();
      const count = await prisma.traceEvent.count({ where: { lotId: lot.id } });
      await post(
        `/shipments/${shipment.id}/damage`,
        { version: 0, lotVersion: 0, quantity: 0.2, reason: 'Stale' },
        'transporter',
      ).expect(409);
      expect(
        (
          await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })
        ).availableQuantity.toNumber(),
      ).toBe(1);
      expect(await prisma.traceEvent.count({ where: { lotId: lot.id } })).toBe(
        count,
      );
    });

    it('replays a harvest without creating another lot or trace event', async () => {
      const cycle = await plantedCycle(1);
      const body = {
        quantity: 0.5,
        unit: 'kg',
        harvestTime: '2026-09-26T00:00:00.000Z',
      };
      const key = randomUUID();
      const first = await post(
        `/production-cycles/${cycle.id}/harvests`,
        body,
        'farm',
        key,
      ).expect(201);
      const replay = await post(
        `/production-cycles/${cycle.id}/harvests`,
        body,
        'farm',
        key,
      ).expect(201);
      expect(replay.body.data.lot.id).toBe(first.body.data.lot.id);
      expect(
        await prisma.harvestEvent.count({ where: { cycleId: cycle.id } }),
      ).toBe(1);
      await post(
        `/production-cycles/${cycle.id}/harvests`,
        { ...body, quantity: 0.6 },
        'farm',
        key,
      ).expect(409);
    });

    it('rejects harvest quantities beyond the production plan', async () => {
      const cycle = await plantedCycle(1);
      await post(`/production-cycles/${cycle.id}/harvests`, {
        quantity: 1.001,
        unit: 'kg',
        harvestTime: '2026-09-26T00:00:00.000Z',
      }).expect(422);
      expect(
        await prisma.harvestEvent.count({ where: { cycleId: cycle.id } }),
      ).toBe(0);
    });

    it('rejects precision that PostgreSQL would silently round', async () => {
      const cycle = await plantedCycle(1);
      await post(`/production-cycles/${cycle.id}/harvests`, {
        quantity: 0.0001,
        unit: 'kg',
        harvestTime: '2026-09-26T00:00:00.000Z',
      }).expect(400);
      expect(
        await prisma.harvestEvent.count({ where: { cycleId: cycle.id } }),
      ).toBe(0);
    });

    it('prevents unrelated organizations from reading internal history and proofs', async () => {
      const { lot } = await harvestedLot();
      const event = await prisma.traceEvent.findFirstOrThrow({
        where: { lotId: lot.id },
      });
      for (const path of [
        `/lots/${lot.id}`,
        `/trace/lots/${lot.id}`,
        `/trace/events/${event.id}/proof`,
        `/blockchain/events/${event.id}/verify`,
      ]) {
        await get(path, 'foreign').expect(403);
        await get(path, 'farm').expect(200);
      }
    });

    it('fails closed for a business account without an organization', async () => {
      await harvestedLot();
      for (const path of [
        '/lots',
        '/production-cycles',
        '/shipments',
        '/iot/devices',
        '/inspections',
        '/certificates',
      ]) {
        const response = await get(path, 'unscoped').expect(200);
        expect(response.body.data).toEqual([]);
      }
    });

    it('validates a missing plot before reaching a foreign-key failure', async () => {
      await post('/production-cycles', {
        farmId,
        productId,
        plotId: randomUUID(),
        cycleCode: 'MISSING-' + randomUUID(),
        maxHarvestQuantity: 1,
        harvestUnit: 'kg',
      }).expect(422);
    });

    it('gives an assigned transporter access to production proofs, and denies outsiders', async () => {
      const { cycle } = await startedShipment();
      const event = await prisma.traceEvent.findFirstOrThrow({
        where: { cycleId: cycle.id, entityType: 'PRODUCTION_CYCLE' },
      });
      await get(`/trace/events/${event.id}/proof`, 'transporter').expect(200);
      await get(`/trace/events/${event.id}/proof`, 'foreign').expect(403);
    });

    it('keeps sibling harvest events out of a lot timeline while retaining cycle history', async () => {
      const cycle = await plantedCycle(2);
      const harvest = async (harvestTime: string) =>
        (
          await post(`/production-cycles/${cycle.id}/harvests`, {
            quantity: 0.5,
            unit: 'kg',
            harvestTime,
          }).expect(201)
        ).body.data;
      const first = await harvest('2026-09-26T00:00:00.000Z');
      const sibling = await harvest('2026-09-27T00:00:00.000Z');
      await post('/shipments', {
        lotId: first.lot.id,
        transporterOrgId,
        retailerOrgId,
        origin: 'Farm',
        destination: 'Retailer',
      }).expect(201);
      const siblingEvent = await prisma.traceEvent.findFirstOrThrow({
        where: { lotId: sibling.lot.id },
      });
      const detail = (
        await get(`/lots/${first.lot.id}`, 'transporter').expect(200)
      ).body.data;
      const publicTrace = (
        await request(app.getHttpServer())
          .get('/api/public/trace/' + first.traceQr.traceToken)
          .expect(200)
      ).body.data;
      for (const projection of [detail, publicTrace]) {
        expect(
          projection.timeline.map(
            (event: { eventId: string }) => event.eventId,
          ),
        ).not.toContain(siblingEvent.id);
        expect(
          projection.timeline.filter(
            (event: { eventType: string }) =>
              event.eventType === 'HARVEST_RECORDED',
          ),
        ).toHaveLength(1);
        expect(
          projection.timeline.some(
            (event: { eventType: string }) =>
              event.eventType === 'CYCLE_PLANTED',
          ),
        ).toBe(true);
      }
      await get(`/trace/events/${siblingEvent.id}/proof`, 'transporter').expect(
        403,
      );
    });

    it('does not label the lot verified when an earlier cycle event is pending or failed', async () => {
      const { lot, cycle, traceQr } = await harvestedLot();
      const events = await prisma.traceEvent.findMany({
        where: { OR: [{ lotId: lot.id }, { cycleId: cycle.id, lotId: null }] },
        orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      });
      const confirm = (event: (typeof events)[number]) =>
        prisma.blockchainProof.create({
          data: {
            eventId: event.id,
            dataHash: event.dataHash,
            network: 'audit-fixture',
            txId: randomBytes(32).toString('hex'),
            channelId: process.env.FABRIC_CHANNEL_NAME ?? 'agritrace',
            recordedAt: new Date(),
            transactionStatus: 'CONFIRMED',
          },
        });
      await confirm(events.at(-1)!);
      const checkStatus = async (status: string) => {
        const detail = (await get(`/lots/${lot.id}`).expect(200)).body.data;
        const publicTrace = (
          await request(app.getHttpServer())
            .get('/api/public/trace/' + traceQr.traceToken)
            .expect(200)
        ).body.data;
        expect(detail.proofStatus).toBe(status);
        expect(publicTrace.proofStatus).toBe(status);
      };
      await checkStatus('PENDING');
      for (const event of events.slice(1, -1)) await confirm(event);
      await prisma.blockchainOutbox.update({
        where: { eventId: events[0].id },
        data: { status: 'DEAD_LETTER' },
      });
      await checkStatus('BLOCKCHAIN_UNAVAILABLE');
      const list = (await get('/lots').expect(200)).body.data;
      expect(
        list.find((item: { lotId: string }) => item.lotId === lot.id)
          .proofStatus,
      ).toBe('BLOCKCHAIN_UNAVAILABLE');
      await confirm(events[0]);
      await checkStatus('BLOCKCHAIN_UNAVAILABLE');
      await prisma.blockchainOutbox.updateMany({
        where: { eventId: { in: events.map((event) => event.id) } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          nextAttemptAt: null,
        },
      });
      await checkStatus('VERIFIED');
    });

    it('does not count previously damaged stock again when the retailer rejects a shipment', async () => {
      const { lot, shipment } = await startedShipment(1);
      await post(
        `/shipments/${shipment.id}/damage`,
        { version: 1, lotVersion: 1, quantity: 0.2, reason: 'Damaged' },
        'transporter',
      ).expect(201);
      await post(
        `/shipments/${shipment.id}/arrive`,
        { version: 2, lotVersion: 2 },
        'transporter',
      ).expect(201);
      await post(
        `/shipments/${shipment.id}/reject`,
        { version: 3, lotVersion: 3, reason: 'Rejected' },
        'retailer',
      ).expect(201);
      const detail = (await get(`/lots/${lot.id}`, 'retailer').expect(200)).body
        .data;
      expect(detail.damagedQuantity).toBe(0.2);
      expect(detail.shipment.rejectedQuantity).toBe(0.8);
    });

    it('makes full damage terminal without leaving floating-point stock', async () => {
      const { lot, shipment } = await startedShipment(0.3);
      await post(
        `/shipments/${shipment.id}/damage`,
        { version: 1, lotVersion: 1, quantity: 0.1, reason: 'First' },
        'transporter',
      ).expect(201);
      await post(
        `/shipments/${shipment.id}/damage`,
        { version: 2, lotVersion: 2, quantity: 0.2, reason: 'Remaining' },
        'transporter',
      ).expect(201);
      const detail = (await get(`/lots/${lot.id}`).expect(200)).body.data;
      expect(detail.availableQuantity).toBe(0);
      expect(detail.damagedQuantity).toBe(0.3);
      expect(detail.currentState).toBe('DAMAGED');
      expect(detail.shipment.status).toBe('FAILED');
      expect(detail.allowedCommands).toEqual([]);
    });

    // Eight real database races need more than the default 5s on busy CI runners.
    it('serializes concurrent harvests without exceeding the production plan', async () => {
      const failures = vi.spyOn(app.get(LotHarvestService), 'recordHarvest');
      for (let attempt = 0; attempt < 8; attempt += 1) {
        failures.mockClear();
        const cycle = await plantedCycle(1);
        const body = {
          quantity: 0.6,
          unit: 'kg',
          harvestTime: '2026-09-26T00:00:00.000Z',
        };
        const results = await Promise.all([
          post(`/production-cycles/${cycle.id}/harvests`, body),
          post(`/production-cycles/${cycle.id}/harvests`, body),
        ]);
        expect(results.filter((result) => result.status === 201)).toHaveLength(
          1,
        );
        const outcomes = await Promise.allSettled(
          failures.mock.results.map((result) => result.value),
        );
        const rejected = outcomes.find(
          (result) => result.status === 'rejected',
        );
        expect(
          [409, 422],
          rejected?.status === 'rejected'
            ? String(rejected.reason) + JSON.stringify(rejected.reason)
            : 'No service failure',
        ).toContain(results.find((result) => result.status !== 201)?.status);
        expect(
          (
            await prisma.harvestEvent.aggregate({
              where: { cycleId: cycle.id },
              _sum: { quantity: true },
            })
          )._sum.quantity?.toNumber(),
        ).toBe(0.6);
      }
      failures.mockRestore();
    }, 30_000);

    it('keeps concurrent trace appends on a single chain', async () => {
      const trace = app.get(TraceService);
      const entityId = randomUUID();
      await Promise.all(
        [0, 1, 2].map((sequence) =>
          prisma.$transaction((tx) =>
            trace.createInTransaction(tx, {
              entityType: 'LOT',
              entityId,
              eventType: 'CONCURRENT_CHECKPOINT',
              actor: { sub: null, organizationId: null, role: 'SYSTEM_ACTOR' },
              businessData: { sequence },
            }),
          ),
        ),
      );
      const events = await prisma.traceEvent.findMany({ where: { entityId } });
      expect(
        events.filter((event) => event.previousEventHash === null),
      ).toHaveLength(1);
      const referenced = new Set(
        events.map((event) => event.previousEventHash),
      );
      expect(
        events.filter((event) => !referenced.has(event.dataHash)),
      ).toHaveLength(1);
    });

    it('records sensor readings only off-chain and anchors explicit digests', async () => {
      const cycle = await plantedCycle();
      const device = (
        await post('/iot/devices', {
          organizationId: farmOrgId,
          cycleId: cycle.id,
          deviceCode: 'SENSOR-' + randomUUID(),
          name: 'Test sensor',
          type: 'TEMPERATURE',
        }).expect(201)
      ).body.data;
      const body = {
        deviceId: device.id,
        cycleId: cycle.id,
        sensorType: 'TEMPERATURE',
        value: 25,
        unit: 'C',
        recordedAt: new Date().toISOString(),
      };
      const before = await prisma.traceEvent.count({
        where: { cycleId: cycle.id },
      });
      const key = randomUUID();
      const reading = await post('/iot/readings', body, 'farm', key).expect(
        201,
      );
      const replay = await post('/iot/readings', body, 'farm', key).expect(201);
      expect(replay.body.data.readingId).toBe(reading.body.data.readingId);
      expect(
        await prisma.traceEvent.count({ where: { cycleId: cycle.id } }),
      ).toBe(before);
      await post(`/iot/cycles/${cycle.id}/digests`, {
        periodStart: new Date(
          new Date(body.recordedAt).getTime() - 60_000,
        ).toISOString(),
        periodEnd: body.recordedAt,
        isFinal: true,
      }).expect(201);
      expect(
        await prisma.traceEvent.count({ where: { cycleId: cycle.id } }),
      ).toBe(before + 1);
      await post(`/production-cycles/${cycle.id}/close`, { version: 1 }).expect(
        201,
      );
      const { cycleId: _cycleId, ...cycleReading } = body;
      await post(
        `/production-cycles/${cycle.id}/sensor-readings`,
        cycleReading,
      ).expect(422);
    });

    it('accepts only in-transit telemetry and chains backdated digest windows', async () => {
      const { shipment } = await startedShipment();
      const device = (
        await post(
          '/iot/devices',
          {
            organizationId: transporterOrgId,
            deviceCode: 'TRACKER-' + randomUUID(),
            name: 'Test tracker',
            type: 'GPS',
          },
          'transporter',
        ).expect(201)
      ).body.data;
      const binding = (
        await post(
          `/iot/shipments/${shipment.id}/devices`,
          { deviceId: device.id },
          'transporter',
        ).expect(201)
      ).body.data;
      const timestamp = new Date(binding.boundAt);
      const body = {
        deviceId: device.id,
        latitude: 10.5,
        longitude: 106.5,
        recordedAt: timestamp.toISOString(),
      };
      await post(
        `/iot/shipments/${shipment.id}/telemetry`,
        { ...body, recordedAt: '2020-01-01T00:00:00.000Z' },
        'transporter',
      ).expect(422);
      await post(
        `/iot/shipments/${shipment.id}/telemetry`,
        body,
        'transporter',
      ).expect(201);
      const digests = [];
      for (const offset of [1000, 2000, 3000]) {
        digests.push(
          (
            await post(
              `/iot/shipments/${shipment.id}/telemetry-digests`,
              {
                periodStart: new Date(
                  timestamp.getTime() - offset,
                ).toISOString(),
                periodEnd: timestamp.toISOString(),
              },
              'transporter',
            ).expect(201)
          ).body.data,
        );
      }
      expect(digests[1].previousDigestHash).toBe(digests[0].digestHash);
      expect(digests[2].previousDigestHash).toBe(digests[1].digestHash);
      await post(
        `/shipments/${shipment.id}/arrive`,
        { version: 1, lotVersion: 1 },
        'transporter',
      ).expect(201);
      await post(
        `/iot/shipments/${shipment.id}/telemetry`,
        body,
        'transporter',
      ).expect(409);
    });

    it('returns exact JSON-safe device sequences in shipment detail', async () => {
      const { shipment } = await startedShipment();
      const device = (
        await post(
          '/iot/devices',
          {
            organizationId: transporterOrgId,
            deviceCode: 'SEQUENCE-TRACKER-' + randomUUID(),
            name: 'Sequence tracker',
            type: 'GPS',
          },
          'transporter',
        ).expect(201)
      ).body.data;
      const binding = (
        await post(
          `/iot/shipments/${shipment.id}/devices`,
          { deviceId: device.id },
          'transporter',
        ).expect(201)
      ).body.data;
      const recordedAt = new Date(binding.boundAt).toISOString();
      const telemetry = {
        deviceId: device.id,
        latitude: 10.5,
        longitude: 106.5,
        recordedAt,
      };
      const sequenced = (
        await post(
          `/iot/shipments/${shipment.id}/telemetry`,
          { ...telemetry, deviceSequence: 0 },
          'transporter',
        ).expect(201)
      ).body.data;
      const unsequenced = (
        await post(
          `/iot/shipments/${shipment.id}/telemetry`,
          telemetry,
          'transporter',
        ).expect(201)
      ).body.data;
      const maximumSequence = 9223372036854775807n;
      const maximum = await prisma.shipmentTelemetry.create({
        data: {
          shipmentId: shipment.id,
          deviceId: device.id,
          bindingId: binding.id,
          deviceSequence: maximumSequence,
          latitude: telemetry.latitude,
          longitude: telemetry.longitude,
          recordedAt: new Date(recordedAt),
        },
      });

      const detail = (
        await get(`/shipments/${shipment.id}`, 'transporter').expect(200)
      ).body.data;
      expect(detail.telemetry).toHaveLength(3);
      expect(detail.telemetry).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: sequenced.telemetryId,
            deviceSequence: '0',
          }),
          expect.objectContaining({
            id: unsequenced.telemetryId,
            deviceSequence: null,
          }),
          expect.objectContaining({
            id: maximum.id,
            deviceSequence: maximumSequence.toString(),
          }),
        ]),
      );
      expect(
        (
          await prisma.shipmentTelemetry.findUniqueOrThrow({
            where: { id: maximum.id },
          })
        ).deviceSequence,
      ).toBe(maximumSequence);
      await get(`/shipments/${shipment.id}`, 'foreign').expect(403);
    });

    it('documents nullable device sequence strings in generated Swagger', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const response =
        document.paths['/api/shipments/{id}']?.get?.responses?.['200'];
      expect(response).toMatchObject({
        content: {
          'application/json': {
            schema: {
              properties: {
                data: { $ref: '#/components/schemas/ShipmentDetailDto' },
              },
            },
          },
        },
      });
      expect(
        document.components?.schemas?.ShipmentTelemetryRecordDto,
      ).toMatchObject({
        properties: { deviceSequence: { type: 'string', nullable: true } },
      });
    });

    it('exposes only reviewed public certificates in a QR trace', async () => {
      const { lot, traceQr } = await harvestedLot();
      const certificate = (
        await post('/certificates', {
          lotId: lot.id,
          type: 'VietGAP',
          issuer: 'Test issuer',
          issueDate: '2026-09-26',
          documentRef: 'private-reference',
          documentHash: 'a'.repeat(64),
          isPublic: true,
        }).expect(201)
      ).body.data;
      const tracePath = '/api/public/trace/' + traceQr.traceToken;
      const pending = await request(app.getHttpServer())
        .get(tracePath)
        .expect(200);
      expect(pending.body.data.certificates).toEqual([]);
      await request(app.getHttpServer())
        .patch(`/api/certificates/${certificate.id}/review`)
        .set('Authorization', bearer('admin'))
        .set('Idempotency-Key', randomUUID())
        .send({ version: 0, status: 'APPROVED' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/certificates/${certificate.id}/review`)
        .set('Authorization', bearer('reviewer'))
        .set('Idempotency-Key', randomUUID())
        .send({ version: certificate.version, status: 'APPROVED' })
        .expect(200);
      const approved = await request(app.getHttpServer())
        .get(tracePath)
        .expect(200);
      expect(approved.body.data.certificates).toHaveLength(1);
      expect(approved.body.data.certificates[0]).not.toHaveProperty(
        'documentRef',
      );
      expect(JSON.stringify(approved.body.data)).not.toContain(users.farm);
    });

    it('projects approved public cycle certificates but excludes pending and private siblings', async () => {
      const { cycle, traceQr } = await harvestedLot();
      for (const fixture of [
        { type: 'PUBLIC_APPROVED', status: 'APPROVED', isPublic: true },
        { type: 'PRIVATE_APPROVED', status: 'APPROVED', isPublic: false },
        { type: 'PUBLIC_PENDING', status: 'PENDING', isPublic: true },
      ]) {
        const certificate = (
          await post('/certificates', {
            cycleId: cycle.id,
            type: fixture.type,
            isPublic: fixture.isPublic,
            issuer: 'Fixture issuer',
            issueDate: '2026-09-26',
            documentRef: 'internal-document',
            documentHash: 'c'.repeat(64),
          }).expect(201)
        ).body.data;
        if (fixture.status === 'APPROVED')
          await request(app.getHttpServer())
            .patch(`/api/certificates/${certificate.id}/review`)
            .set('Authorization', bearer('reviewer'))
            .set('Idempotency-Key', randomUUID())
            .send({
              version: certificate.version,
              status: 'APPROVED',
              reviewNote: 'internal-review',
            })
            .expect(200);
      }
      const result = await request(app.getHttpServer())
        .get('/api/public/trace/' + traceQr.traceToken)
        .expect(200);
      expect(
        result.body.data.certificates.map((c: { type: string }) => c.type),
      ).toEqual(['PUBLIC_APPROVED']);
      expect(JSON.stringify(result.body.data)).not.toContain(
        'internal-document',
      );
      expect(JSON.stringify(result.body.data)).not.toContain('internal-review');
    });

    it.each(['admin', 'auditor'])(
      'keeps %s business commands read-only without changing DB, events, outbox or quantities',
      async (user) => {
        const { cycle, lot, shipment } = await startedShipment();
        const certificate = (
          await post('/certificates', {
            lotId: lot.id,
            type: 'VietGAP',
            issuer: 'Fixture',
            issueDate: '2026-09-26',
            documentRef: 'private',
            documentHash: 'a'.repeat(64),
          }).expect(201)
        ).body.data;
        const routes = [
          '/production-cycles',
          ...[
            'plant',
            'care',
            'sensor-readings',
            'close',
            'cancel',
            'harvests',
          ].map((action) => `/production-cycles/${cycle.id}/${action}`),
          '/shipments',
          ...['start', 'arrive', 'receive', 'reject', 'damage'].map(
            (action) => `/shipments/${shipment.id}/${action}`,
          ),
          '/certificates',
          '/inspections',
          '/iot/readings',
          `/iot/cycles/${cycle.id}/digests`,
          ...['telemetry', 'devices', 'telemetry-digests'].map(
            (action) => `/iot/shipments/${shipment.id}/${action}`,
          ),
          `/iot/shipments/${shipment.id}/devices/${randomUUID()}/unbind`,
        ];
        const snapshot = async () => ({
          cycles: await prisma.productionCycle.count(),
          care: await prisma.careRecord.count(),
          harvests: await prisma.harvestEvent.count(),
          lots: await prisma.lot.count(),
          shipments: await prisma.shipment.count(),
          movements: await prisma.quantityMovement.count(),
          readings: await prisma.sensorReading.count(),
          digests: await prisma.sensorDigest.count(),
          telemetry: await prisma.shipmentTelemetry.count(),
          bindings: await prisma.shipmentTrackingBinding.count(),
          telemetryDigests: await prisma.shipmentTelemetryDigest.count(),
          certificates: await prisma.certificate.count(),
          inspections: await prisma.inspection.count(),
          events: await prisma.traceEvent.count(),
          outbox: await prisma.blockchainOutbox.count(),
          idempotency: await prisma.idempotencyRecord.count(),
          lot: await prisma.lot.findUnique({ where: { id: lot.id } }),
          shipment: await prisma.shipment.findUnique({
            where: { id: shipment.id },
          }),
        });
        const before = await snapshot();
        for (const path of routes) await post(path, {}, user).expect(403);
        await request(app.getHttpServer())
          .patch(`/api/certificates/${certificate.id}/review`)
          .set('Authorization', bearer(user))
          .set('Idempotency-Key', randomUUID())
          .send({ status: 'APPROVED' })
          .expect(403);
        expect(await snapshot()).toEqual(before);
        for (const path of [
          '/production-cycles',
          '/lots',
          '/shipments',
          '/certificates',
          '/inspections',
        ])
          await get(path, user).expect(200);
        const projection = await get(`/lots/${lot.id}`, user).expect(200);
        expect(projection.body.data.allowedCommands).toEqual([]);
      },
    );

    it('recovers the committed harvest journal after response-cache completion fails', async () => {
      const cycle = await plantedCycle();
      const key = randomUUID();
      const body = {
        quantity: 1,
        unit: 'kg',
        harvestTime: '2026-09-26T00:00:00.000Z',
      };
      vi.spyOn(app.get(IdempotencyService), 'complete').mockRejectedValueOnce(
        new Error('simulated cache persistence failure'),
      );
      await post(
        `/production-cycles/${cycle.id}/harvests`,
        body,
        'farm',
        key,
      ).expect(500);
      const record = await prisma.idempotencyRecord.findFirstOrThrow({
        where: { idempotencyKey: key },
      });
      expect(record.status).toBe('PROCESSING');
      const journal = await prisma.commandCommit.findUniqueOrThrow({
        where: { idempotencyRecordId: record.id },
      });
      // A reloaded browser has only its key, not the raw harvest form.
      const recovered = await get(
        `/production-cycles/${cycle.id}/harvest-request-status`,
      )
        .set('Idempotency-Key', key)
        .expect(200);
      const committedBody = journal.responseBody as unknown as {
        lot: { id: string; lotCode: string };
        traceQr: { traceToken: string };
      };
      expect(recovered.headers['cache-control']).toBe('no-store');
      expect(recovered.body.data).toEqual({
        status: 'COMMITTED',
        result: {
          lot: { id: committedBody.lot.id, lotCode: committedBody.lot.lotCode },
          traceQr: { traceToken: committedBody.traceQr.traceToken },
        },
      });
      const replay = await post(
        `/production-cycles/${cycle.id}/harvests`,
        body,
        'farm',
        key,
      ).expect(201);
      expect(replay.body.data).toEqual(journal.responseBody);
      expect(
        await prisma.harvestEvent.count({ where: { cycleId: cycle.id } }),
      ).toBe(1);
      expect(
        await prisma.harvestSensorWindow.count({
          where: { cycleId: cycle.id },
        }),
      ).toBe(1);
      const lotId = committedBody.lot.id;
      expect(
        await prisma.lot.count({ where: { harvest: { cycleId: cycle.id } } }),
      ).toBe(1);
      expect(await prisma.traceQr.count({ where: { lotId } })).toBe(1);
      expect(
        await prisma.quantityMovement.count({
          where: { lotId, type: 'HARVEST_IN' },
        }),
      ).toBe(1);
      const movement = await prisma.quantityMovement.findFirstOrThrow({
        where: { lotId, type: 'HARVEST_IN' },
      });
      expect(Number(movement.afterQty)).toBe(1);
      expect(await prisma.traceEvent.count({ where: { lotId } })).toBe(2);
      expect(
        await prisma.blockchainOutbox.count({
          where: { traceEvent: { lotId } },
        }),
      ).toBe(2);
      await expect(
        prisma.commandCommit.update({
          where: { id: journal.id },
          data: { responseStatus: 202 },
        }),
      ).rejects.toThrow();
      await post(
        `/production-cycles/${cycle.id}/harvests`,
        body,
        'foreign',
        key,
      ).expect(403);
    });

    it('keeps missing, expired processing and unjournaled success harvests unresolved', async () => {
      const cycle = await plantedCycle();
      const body = {
        quantity: 1,
        unit: 'kg',
        harvestTime: '2026-09-26T00:00:00.000Z',
      };
      const status = (key: string, user = 'farm') =>
        get(`/production-cycles/${cycle.id}/harvest-request-status`, user).set(
          'Idempotency-Key',
          key,
        );
      expect((await status(randomUUID()).expect(200)).body.data).toEqual({
        status: 'NOT_FOUND',
      });
      await get(`/production-cycles/${cycle.id}/harvest-request-status`).expect(
        400,
      );
      await status('x'.repeat(256)).expect(400);
      const scope = canonicalSha256({
        requesterId: users.farm,
        role: 'FARM_STAFF',
        organizationId: farmOrgId,
      });
      const key = randomUUID();
      const record = await prisma.idempotencyRecord.create({
        data: {
          requesterId: users.farm,
          operation: 'RECORD_HARVEST',
          requestType: 'COMMAND',
          idempotencyKey: key,
          authorizationScope: scope,
          requestHash: canonicalSha256({ cycleId: cycle.id, ...body }),
          createdAt: new Date('2026-01-01T00:00:00Z'),
          expiresAt: new Date('2026-01-02T00:00:00Z'),
          status: 'PROCESSING',
        },
      });
      expect((await status(key).expect(200)).body.data).toEqual({
        status: 'NEEDS_RECONCILIATION',
      });
      await post(
        `/production-cycles/${cycle.id}/harvests`,
        body,
        'farm',
        key,
      ).expect(409);
      await prisma.idempotencyRecord.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          responseStatus: 201,
          responseBody: { lot: { id: randomUUID() } },
        },
      });
      expect((await status(key).expect(200)).body.data).toEqual({
        status: 'NEEDS_RECONCILIATION',
      });
      await status(key, 'foreign').expect(403);
      await status(key, 'admin').expect(403);
      expect(
        await prisma.harvestEvent.count({ where: { cycleId: cycle.id } }),
      ).toBe(0);
    });

    it('only recovers a journal for its requester, current scope and original cycle', async () => {
      const cycle = await plantedCycle(),
        otherCycle = await plantedCycle();
      const key = randomUUID();
      await post(
        `/production-cycles/${cycle.id}/harvests`,
        {
          quantity: 1,
          unit: 'kg',
          harvestTime: '2026-09-26T00:00:00.000Z',
        },
        'farm',
        key,
      ).expect(201);
      const status = (id = cycle.id, actor = 'farm') =>
        get(`/production-cycles/${id}/harvest-request-status`, actor).set(
          'Idempotency-Key',
          key,
        );
      expect((await status(otherCycle.id).expect(200)).body.data).toEqual({
        status: 'NEEDS_RECONCILIATION',
      });
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: 'FARM_STAFF' },
      });
      const colleague = await prisma.user.create({
        data: {
          email: `colleague-${randomUUID()}@example.test`,
          fullName: 'Recovery colleague',
          roleId: role.id,
          organizationId: farmOrgId,
          passwordHash: 'not-a-login-fixture',
        },
      });
      users.colleague = colleague.id;
      sessionIds.colleague = randomUUID();
      await prisma.refreshSession.create({
        data: {
          id: sessionIds.colleague,
          familyId: sessionIds.colleague,
          userId: colleague.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      expect(
        (await status(cycle.id, 'colleague').expect(200)).body.data,
      ).toEqual({ status: 'NOT_FOUND' });
      // A legacy authorization scope is never enough to disclose a QR.
      const record = await prisma.idempotencyRecord.findFirstOrThrow({
        where: { idempotencyKey: key },
      });
      await prisma.idempotencyRecord.update({
        where: { id: record.id },
        data: { authorizationScope: null },
      });
      expect((await status().expect(200)).body.data).toEqual({
        status: 'NEEDS_RECONCILIATION',
      });
    });

    it('reports a terminal rolled-back harvest rejection without inventing a result', async () => {
      const cycle = await plantedCycle(),
        key = randomUUID();
      await post(
        `/production-cycles/${cycle.id}/harvests`,
        {
          quantity: 2,
          unit: 'kg',
          harvestTime: '2026-09-26T00:00:00.000Z',
        },
        'farm',
        key,
      ).expect(422);
      const status = await get(
        `/production-cycles/${cycle.id}/harvest-request-status`,
      )
        .set('Idempotency-Key', key)
        .expect(200);
      expect(status.body.data).toEqual({ status: 'REJECTED' });
      expect(
        await prisma.harvestEvent.count({ where: { cycleId: cycle.id } }),
      ).toBe(0);
    });

    it('keeps NO_DATA windows sealed with no invented digest or membership', async () => {
      const { lot, harvest, sensorWindow } = await harvestedLot();
      expect(sensorWindow).toMatchObject({
        status: 'NO_DATA',
        readingCount: 0,
        digestHash: null,
        harvestId: harvest.id,
      });
      expect(sensorWindow.sealedAt).toBeTruthy();
      expect(
        await prisma.harvestSensorMembership.count({
          where: { windowId: sensorWindow.id },
        }),
      ).toBe(0);
      await expect(
        prisma.harvestSensorWindow.update({
          where: { id: sensorWindow.id },
          data: { digestHash: 'a'.repeat(64) },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.lot.update({
          where: { id: lot.id },
          data: { lotCode: 'mutated-label' },
        }),
      ).rejects.toThrow();
    });

    it('rolls back harvest, window, Lot, movement and outbox if trace insertion fails', async () => {
      const cycle = await plantedCycle();
      const snapshot = async () => ({
        harvests: await prisma.harvestEvent.count({
          where: { cycleId: cycle.id },
        }),
        windows: await prisma.harvestSensorWindow.count({
          where: { cycleId: cycle.id },
        }),
        lots: await prisma.lot.count({
          where: { harvest: { cycleId: cycle.id } },
        }),
        movements: await prisma.quantityMovement.count({
          where: { lot: { harvest: { cycleId: cycle.id } } },
        }),
        events: await prisma.traceEvent.count({ where: { cycleId: cycle.id } }),
        outbox: await prisma.blockchainOutbox.count({
          where: { traceEvent: { cycleId: cycle.id } },
        }),
      });
      const before = await snapshot();
      const key = randomUUID();
      const body = {
        quantity: 1,
        unit: 'kg',
        harvestTime: '2026-09-26T00:00:00.000Z',
      };
      vi.spyOn(
        app.get(TraceService),
        'createInTransaction',
      ).mockRejectedValueOnce(new Error('simulated trace storage failure'));
      await post(
        `/production-cycles/${cycle.id}/harvests`,
        body,
        'farm',
        key,
      ).expect(500);
      expect(await snapshot()).toEqual(before);
      const record = await prisma.idempotencyRecord.findFirstOrThrow({
        where: { idempotencyKey: key },
      });
      expect(record.status).toBe('PROCESSING');
      expect(
        await prisma.commandCommit.findUnique({
          where: { idempotencyRecordId: record.id },
        }),
      ).toBeNull();
      await prisma.idempotencyRecord.update({
        where: { id: record.id },
        // Model an old, expired PROCESSING fixture while retaining the DB's
        // expiresAt >= createdAt invariant; no production record is changed.
        data: {
          createdAt: new Date(Date.now() - 2 * 86400000),
          expiresAt: new Date(Date.now() - 86400000),
        },
      });
      await post(
        `/production-cycles/${cycle.id}/harvests`,
        body,
        'farm',
        key,
      ).expect(409);
      expect(await snapshot()).toEqual(before);
    });

    it('separates consecutive sensor windows and excludes readings arriving after cutoff', async () => {
      const cycle = await plantedCycle(2);
      const device = (
        await post('/iot/devices', {
          organizationId: farmOrgId,
          cycleId: cycle.id,
          deviceCode: 'WINDOW-' + randomUUID(),
          name: 'Window sensor',
          type: 'TEMPERATURE',
        }).expect(201)
      ).body.data;
      const read = async (recordedAt: string, value: number) =>
        (
          await post('/iot/readings', {
            deviceId: device.id,
            cycleId: cycle.id,
            sensorType: 'TEMPERATURE',
            value,
            unit: 'C',
            recordedAt,
          }).expect(201)
        ).body.data;
      const firstReading = await read('2026-09-25T12:00:00.000Z', 25);
      const first = (
        await post(`/production-cycles/${cycle.id}/harvests`, {
          quantity: 1,
          unit: 'kg',
          harvestTime: '2026-09-26T00:00:00.000Z',
        }).expect(201)
      ).body.data;
      const late = await read('2026-09-25T18:00:00.000Z', 26);
      const nextReading = await read('2026-09-26T12:00:00.000Z', 27);
      const second = (
        await post(`/production-cycles/${cycle.id}/harvests`, {
          quantity: 1,
          unit: 'kg',
          harvestTime: '2026-09-27T00:00:00.000Z',
        }).expect(201)
      ).body.data;
      expect(first.sensorWindow).toMatchObject({
        status: 'FINALIZED',
        readingCount: 1,
        includeStart: true,
      });
      expect(second.sensorWindow).toMatchObject({
        status: 'FINALIZED',
        readingCount: 1,
        includeStart: false,
        periodStart: first.sensorWindow.periodEnd,
      });
      for (const [result, reading] of [
        [first, firstReading],
        [second, nextReading],
      ]) {
        const window = result.sensorWindow;
        const members = await prisma.harvestSensorMembership.findMany({
          where: { windowId: window.id },
        });
        expect(members.map((member) => member.readingId)).toEqual([
          reading.readingId,
        ]);
        const raw = await prisma.sensorReading.findUniqueOrThrow({
          where: { id: reading.readingId },
        });
        expect(window.digestHash).toBe(
          canonicalSha256({
            schemaVersion: 'harvest-sensor-1',
            cycleId: cycle.id,
            harvestId: result.harvest.id,
            periodStart: window.periodStart,
            periodEnd: window.periodEnd,
            includeStart: window.includeStart,
            reconciliationId: null,
            readings: [
              {
                id: raw.id,
                deviceId: raw.deviceId,
                sensorType: raw.sensorType,
                value: raw.value.toString(),
                unit: raw.unit,
                recordedAt: raw.recordedAt.toISOString(),
              },
            ],
          }),
        );
      }
      expect(
        await prisma.lateSensorReading.findUnique({
          where: { readingId: late.readingId },
        }),
      ).toMatchObject({ closedHarvestId: first.harvest.id });
      expect(
        await prisma.harvestSensorMembership.count({
          where: { readingId: late.readingId },
        }),
      ).toBe(0);
    });

    it('sells the exact remaining quantity once and permits recall after SOLD without a zero movement', async () => {
      const { lot, shipment, traceQr } = await deliveredLot(0.3);
      await post(
        `/lots/${lot.id}/mark-for-sale`,
        { version: 3, shipmentVersion: 3 },
        'retailer',
      ).expect(201);
      const key = randomUUID();
      const body = { version: 4, shipmentVersion: 3 };
      const sold = await post(
        `/lots/${lot.id}/mark-sold`,
        body,
        'retailer',
        key,
      ).expect(201);
      expect(sold.body.data).toMatchObject({
        currentState: 'SOLD',
        availableQuantity: 0,
        version: 5,
      });
      expect(
        (
          await post(`/lots/${lot.id}/mark-sold`, body, 'retailer', key).expect(
            201,
          )
        ).body.data,
      ).toEqual(sold.body.data);
      const movements = await prisma.quantityMovement.findMany({
        where: { lotId: lot.id, type: 'SALE_OUT' },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].quantity.toString()).toBe('0.3');
      expect(movements[0].delta.toString()).toBe('-0.3');
      expect(movements[0].afterQty.toString()).toBe('0');
      await post(
        `/lots/${lot.id}/mark-for-sale`,
        { version: 5, shipmentVersion: 3 },
        'retailer',
      ).expect(409);
      await post(
        `/lots/${lot.id}/recall`,
        { version: 5, shipmentVersion: 3, reason: 'Recall sold stock' },
        'retailer',
      ).expect(201);
      expect(
        await prisma.quantityMovement.count({ where: { lotId: lot.id } }),
      ).toBe(2);
      expect(
        (await get(`/shipments/${shipment.id}`, 'retailer').expect(200)).body
          .data.status,
      ).toBe('DELIVERED');
      const trace = await request(app.getHttpServer())
        .get(`/api/public/trace/${traceQr.traceToken}`)
        .expect(200);
      expect(trace.body.data.currentState).toBe('RECALLED');
      expect(JSON.stringify(trace.body.data.warnings)).toContain('RECALL');
    });

    it('serializes competing sale requests and keeps state, quantity and outbox atomic', async () => {
      const { lot } = await deliveredLot();
      await post(
        `/lots/${lot.id}/mark-for-sale`,
        { version: 3, shipmentVersion: 3 },
        'retailer',
      ).expect(201);
      const results = await Promise.all([
        post(
          `/lots/${lot.id}/mark-sold`,
          { version: 4, shipmentVersion: 3 },
          'retailer',
        ),
        post(
          `/lots/${lot.id}/mark-sold`,
          { version: 4, shipmentVersion: 3 },
          'retailer',
        ),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      expect(
        await prisma.quantityMovement.count({
          where: { lotId: lot.id, type: 'SALE_OUT' },
        }),
      ).toBe(1);
      const events = await prisma.traceEvent.findMany({
        where: { lotId: lot.id, eventType: 'LOT_SOLD' },
        include: { blockchainOutbox: true },
      });
      expect(events).toHaveLength(1);
      expect(events[0].blockchainOutbox?.status).toBe('PENDING');
    });

    it('recalls in-transit stock only by its custodian and fails the open shipment atomically', async () => {
      const { lot, shipment } = await startedShipment();
      const body = {
        version: 1,
        shipmentVersion: 1,
        reason: 'Withdraw in-transit stock',
      };
      await post(`/lots/${lot.id}/recall`, body, 'farm').expect(403);
      await post(
        `/lots/${lot.id}/recall`,
        { ...body, shipmentVersion: 0 },
        'transporter',
      ).expect(409);
      expect(
        (await get(`/shipments/${shipment.id}`, 'transporter').expect(200)).body
          .data.status,
      ).toBe('IN_TRANSIT');
      const key = randomUUID();
      await post(`/lots/${lot.id}/recall`, body, 'transporter', key).expect(
        201,
      );
      await post(`/lots/${lot.id}/recall`, body, 'transporter', key).expect(
        201,
      );
      expect(
        (await get(`/shipments/${shipment.id}`, 'transporter').expect(200)).body
          .data,
      ).toMatchObject({ status: 'FAILED', version: 2 });
      expect(
        await prisma.quantityMovement.count({
          where: { lotId: lot.id, type: 'RECALL_OUT' },
        }),
      ).toBe(1);
      await post(
        `/lots/${lot.id}/recall`,
        { version: 2, shipmentVersion: 2, reason: 'Must not reclaim custody' },
        'farm',
      ).expect(403);
    });

    it('expires past-date stock once and retains its immutable origin evidence', async () => {
      const cycle = await plantedCycle();
      const yesterday = new Date(Date.now() - 86400000)
        .toISOString()
        .slice(0, 10);
      const fixture = (
        await post(`/production-cycles/${cycle.id}/harvests`, {
          quantity: 1,
          unit: 'kg',
          harvestTime: '2026-09-26T00:00:00.000Z',
          expiryDate: yesterday,
        }).expect(201)
      ).body.data;
      const key = randomUUID();
      const body = { version: 0, reason: 'Past expiry date' };
      await post(`/lots/${fixture.lot.id}/expire`, body, 'farm', key).expect(
        201,
      );
      await post(`/lots/${fixture.lot.id}/expire`, body, 'farm', key).expect(
        201,
      );
      expect(
        await prisma.quantityMovement.count({
          where: { lotId: fixture.lot.id, type: 'EXPIRE_OUT' },
        }),
      ).toBe(1);
      expect(
        (await get(`/lots/${fixture.lot.id}`).expect(200)).body.data,
      ).toMatchObject({ currentState: 'EXPIRED', availableQuantity: 0 });
    });

    it('keeps approved certificates immutable and publishes only their approved replacement', async () => {
      const { lot, traceQr } = await harvestedLot();
      const body = {
        lotId: lot.id,
        type: 'CERTIFICATION',
        issuer: 'Reviewer fixture',
        issueDate: '2026-09-26',
        documentRef: 'private://certificate-fixture',
        documentHash: 'a'.repeat(64),
        isPublic: true,
      };
      const original = (await post('/certificates', body).expect(201)).body
        .data;
      const approve = (id: string, key = randomUUID()) =>
        request(app.getHttpServer())
          .patch(`/api/certificates/${id}/review`)
          .set('Authorization', bearer('reviewer'))
          .set('Idempotency-Key', key)
          .send({ version: 0, status: 'APPROVED' });
      await approve(original.id).expect(200);
      const correction = (
        await post('/certificates', {
          ...body,
          supersedesId: original.id,
          correctionReason: 'Correct the document',
          documentHash: 'b'.repeat(64),
        }).expect(201)
      ).body.data;
      const publicTrace = () =>
        request(app.getHttpServer()).get(
          `/api/public/trace/${traceQr.traceToken}`,
        );
      expect(
        (await publicTrace().expect(200)).body.data.certificates.map(
          (certificate: { documentHash: string }) => certificate.documentHash,
        ),
      ).toEqual(['a'.repeat(64)]);
      const key = randomUUID();
      await approve(correction.id, key).expect(200);
      await approve(correction.id, key).expect(200);
      expect(
        (await publicTrace().expect(200)).body.data.certificates.map(
          (certificate: { documentHash: string }) => certificate.documentHash,
        ),
      ).toEqual(['b'.repeat(64)]);
      await expect(
        prisma.certificate.update({
          where: { id: original.id },
          data: { documentHash: 'c'.repeat(64) },
        }),
      ).rejects.toThrow();
      await post('/certificates', {
        ...body,
        supersedesId: original.id,
        correctionReason: 'Stale replacement',
      }).expect(409);
    });

    it.each(['admin', 'auditor', 'foreign'])(
      'denies Lot writes by %s before creating idempotency or business data',
      async (user) => {
        const { lot } = await harvestedLot();
        const before = {
          lot: await prisma.lot.findUnique({ where: { id: lot.id } }),
          records: await prisma.idempotencyRecord.count({
            where: { requesterId: users[user] },
          }),
          events: await prisma.traceEvent.count({ where: { lotId: lot.id } }),
          movements: await prisma.quantityMovement.count({
            where: { lotId: lot.id },
          }),
        };
        for (const command of [
          'damage',
          'mark-for-sale',
          'mark-sold',
          'recall',
          'expire',
        ]) {
          const body =
            command === 'damage'
              ? { version: 0, reason: 'Not authorized', quantity: 0.1 }
              : ['recall', 'expire'].includes(command)
                ? { version: 0, reason: 'Not authorized' }
                : { version: 0 };
          await post(`/lots/${lot.id}/${command}`, body, user).expect(403);
        }
        expect({
          lot: await prisma.lot.findUnique({ where: { id: lot.id } }),
          records: await prisma.idempotencyRecord.count({
            where: { requesterId: users[user] },
          }),
          events: await prisma.traceEvent.count({ where: { lotId: lot.id } }),
          movements: await prisma.quantityMovement.count({
            where: { lotId: lot.id },
          }),
        }).toEqual(before);
      },
    );

    it('uses exact Farm damage movements and blocks commands after full damage', async () => {
      const { lot } = await harvestedLot(0.3);
      await post(`/lots/${lot.id}/damage`, {
        version: 0,
        quantity: 0.1,
        reason: 'Partial Farm damage',
      }).expect(201);
      expect(
        (await get(`/lots/${lot.id}`).expect(200)).body.data,
      ).toMatchObject({ currentState: 'HARVESTED', availableQuantity: 0.2 });
      const key = randomUUID();
      const body = {
        version: 1,
        quantity: 0.2,
        reason: 'Full remaining damage',
      };
      await post(`/lots/${lot.id}/damage`, body, 'farm', key).expect(201);
      await post(`/lots/${lot.id}/damage`, body, 'farm', key).expect(201);
      expect(
        (await get(`/lots/${lot.id}`).expect(200)).body.data,
      ).toMatchObject({ currentState: 'DAMAGED', availableQuantity: 0 });
      expect(
        await prisma.quantityMovement.count({
          where: { lotId: lot.id, type: 'DAMAGE_OUT' },
        }),
      ).toBe(2);
      await post('/shipments', {
        lotId: lot.id,
        transporterOrgId,
        retailerOrgId,
        origin: 'Farm',
        destination: 'Retailer',
      }).expect(409);
    });

    it('validates malformed identifiers and blank master-data names at the HTTP boundary', async () => {
      await get('/inspections?lotId=not-a-uuid').expect(400);
      await get('/certificates?cycleId=not-a-uuid').expect(400);
      await post('/catalog/products', { productName: '   ' }, 'admin').expect(
        400,
      );
      await post(
        '/organizations',
        { name: '   ', type: 'FARM' },
        'admin',
      ).expect(400);
      await post(
        '/users',
        {
          email: 'blank@example.test',
          fullName: '   ',
          password: 'test-password-123',
          roleCode: 'FARM_STAFF',
          organizationId: farmOrgId,
        },
        'admin',
      ).expect(400);
    });
  },
);
