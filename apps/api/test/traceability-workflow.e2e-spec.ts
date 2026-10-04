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
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import { LotsService } from '../src/modules/lots/lots.service.js';

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

    beforeAll(async () => {
      await prisma.$queryRaw`SELECT 1`;
      const organization = async (type: 'FARM' | 'TRANSPORTER' | 'RETAILER') =>
        prisma.organization.create({
          data: { name: `Workflow ${type} ${randomUUID()}`, type },
        });
      const farmOrg = await organization('FARM');
      const transporter = await organization('TRANSPORTER');
      const retailer = await organization('RETAILER');
      const foreignFarm = await organization('FARM');
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
    }, 30_000);

    afterAll(async () => {
      await app?.close();
      await prisma.$disconnect();
    });

    afterEach(() => vi.restoreAllMocks());

    function get(path: string, user = 'farm') {
      return request(app.getHttpServer())
        .get('/api' + path)
        .set('Authorization', 'Bearer ' + jwt.sign({ sub: users[user] }));
    }
    function post(
      path: string,
      body: object,
      user = 'farm',
      key = randomUUID(),
    ) {
      return request(app.getHttpServer())
        .post('/api' + path)
        .set('Authorization', 'Bearer ' + jwt.sign({ sub: users[user] }))
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

    it('reports actual harvests with organization scope and validates filters', async () => {
      const { lot } = await harvestedLot(12);
      const result = await get('/reports?productId=' + productId).expect(200);
      expect(
        result.body.data.rows.find(
          (r: { lotId: string }) => r.lotId === lot.id,
        ),
      ).toMatchObject({
        harvested: 12,
        shipped: 0,
        received: 0,
        damaged: 0,
        rejected: 0,
      });
      expect(
        (
          await get('/reports?organizationId=' + farmOrgId, 'foreign').expect(
            200,
          )
        ).body.data.rows,
      ).toEqual([]);
      await get('/reports?from=2026-10-05&to=2026-10-04').expect(400);
      await get('/reports?productId=bad').expect(400);
      expect(
        (await get('/reports?from=2027-01-01').expect(200)).body.data.rows,
      ).toEqual([]);
    });

    it('persists notification read state and rejects inaccessible targets', async () => {
      const { lot } = await harvestedLot(2);
      const event = await prisma.traceEvent.findFirstOrThrow({
        where: { lotId: lot.id },
      });
      const target = await get('/notifications/' + event.id + '/target').expect(
        200,
      );
      expect(target.body.data.href).toBe('/lots/' + lot.id);
      await post('/notifications/' + event.id + '/read', {}).expect(201);
      await post('/notifications/' + event.id + '/read', {}).expect(201);
      expect(
        await prisma.notificationRead.count({
          where: { userId: users.farm, eventId: event.id },
        }),
      ).toBe(1);
      await get('/notifications/' + event.id + '/target', 'foreign').expect(
        404,
      );
      await post('/notifications/' + event.id + '/read', {}, 'foreign').expect(
        404,
      );
      await get('/notifications?page=0').expect(400);
      const page = await get('/notifications?page=1').expect(200);
      expect(page.body.data.items.length).toBeLessThanOrEqual(20);
    });

    it('reads persisted sensor history and evaluates configured thresholds without leaking organizations', async () => {
      const cycle = await plantedCycle(5);
      const device = await prisma.iotDevice.create({
        data: {
          organizationId: farmOrgId,
          cycleId: cycle.id,
          deviceCode: randomUUID(),
          name: 'History device',
          type: 'temperature',
        },
      });
      await post('/iot/readings', {
        deviceId: device.id,
        cycleId: cycle.id,
        sensorType: 'temperature',
        unit: 'C',
        value: 35,
        recordedAt: '2026-09-25T01:00:00Z',
      }).expect(201);
      vi.stubEnv(
        'SENSOR_THRESHOLDS_JSON',
        JSON.stringify([
          { sensorType: 'temperature', unit: 'C', min: 10, max: 30 },
        ]),
      );
      try {
        const result = await get('/iot/history?deviceId=' + device.id).expect(
          200,
        );
        expect(result.body.data.items).toHaveLength(1);
        expect(result.body.data.items[0]).toMatchObject({
          alert: 'HIGH',
          threshold: { min: 10, max: 30 },
        });
        expect(
          (
            await get('/iot/history?deviceId=' + device.id, 'foreign').expect(
              200,
            )
          ).body.data.total,
        ).toBe(0);
        expect(
          (
            await get(
              '/iot/history?deviceId=' + device.id + '&from=2026-09-26',
            ).expect(200)
          ).body.data.total,
        ).toBe(0);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('uploads private media, safely replays retries, enforces access and withdraws public access', async () => {
      const { lot, traceQr } = await harvestedLot(3);
      const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=',
        'base64',
      );
      const key = randomUUID();
      const upload = () =>
        request(app.getHttpServer())
          .post('/api/media')
          .set('Authorization', 'Bearer ' + jwt.sign({ sub: users.farm }))
          .set('Idempotency-Key', key)
          .field('targetType', 'LOT')
          .field('targetId', lot.id)
          .attach('file', image, {
            filename: 'proof.png',
            contentType: 'image/png',
          });
      const uploaded = await upload().expect(201);
      const id = uploaded.body.data.id;
      expect((await upload().expect(201)).body.data.id).toBe(id);
      await get('/media/' + id + '/content')
        .expect(200)
        .expect('Content-Type', /image\/png/);
      await get('/media/' + id + '/content', 'foreign').expect(403);
      const publicPath = '/api/public/trace/' + traceQr.traceToken + '/media';
      expect(
        (await request(app.getHttpServer()).get(publicPath).expect(200)).body
          .data,
      ).toEqual([]);
      await request(app.getHttpServer())
        .get(publicPath + '/' + id + '/content')
        .expect(404);
      const visibility = (isPublic: boolean) =>
        request(app.getHttpServer())
          .patch('/api/media/' + id)
          .set('Authorization', 'Bearer ' + jwt.sign({ sub: users.farm }))
          .send({ isPublic });
      await visibility(true).expect(200);
      expect(
        (await request(app.getHttpServer()).get(publicPath).expect(200)).body
          .data[0].id,
      ).toBe(id);
      await request(app.getHttpServer())
        .get(publicPath + '/' + id + '/content')
        .expect(200)
        .expect('X-Content-Type-Options', 'nosniff');
      await visibility(false).expect(200);
      await request(app.getHttpServer())
        .get(publicPath + '/' + id + '/content')
        .expect(404);
      await request(app.getHttpServer())
        .delete('/api/media/' + id)
        .set('Authorization', 'Bearer ' + jwt.sign({ sub: users.farm }))
        .expect(200);
      await get('/media/' + id + '/content').expect(404);
    });

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
              actor: { sub: null, organizationId: null, role: 'SYSTEM' },
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
      const harvest = async () =>
        (
          await post(`/production-cycles/${cycle.id}/harvests`, {
            quantity: 0.5,
            unit: 'kg',
            harvestTime: '2026-09-26T00:00:00.000Z',
          }).expect(201)
        ).body.data;
      const first = await harvest();
      const sibling = await harvest();
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
            txId: randomUUID(),
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

    it('serializes concurrent harvests without exceeding the production plan', async () => {
      const failures = vi.spyOn(app.get(LotsService), 'recordHarvest');
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
    });

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
              actor: { sub: null, organizationId: null, role: 'SYSTEM' },
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
        periodEnd: new Date(
          new Date(body.recordedAt).getTime() + 60_000,
        ).toISOString(),
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
      const timestamp = new Date(new Date(binding.boundAt).getTime() + 1000);
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
      for (const offset of [3000, 2000, 1000]) {
        digests.push(
          (
            await post(
              `/iot/shipments/${shipment.id}/telemetry-digests`,
              {
                periodStart: new Date(timestamp.getTime() - 1000).toISOString(),
                periodEnd: new Date(timestamp.getTime() + offset).toISOString(),
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
        .set('Authorization', 'Bearer ' + jwt.sign({ sub: users.admin }))
        .set('Idempotency-Key', randomUUID())
        .send({ status: 'APPROVED' })
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
