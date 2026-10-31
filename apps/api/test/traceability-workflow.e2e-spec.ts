import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
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
import { privateTraceEvidenceMatches } from '../src/modules/trace/trace-evidence.js';
import { provisionChain } from './support/chain-scope.js';
import { confirmSimulatedPermissions } from '../src/modules/ledger/simulated-ledger.js';
import { seedCycleEvidence } from './support/cycle-evidence.js';

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
    let chainId: string;
    const users: Record<string, string> = {};
    const sessionIds: Record<string, string> = {};
    const cycleEvidence = new Map<
      string,
      Awaited<ReturnType<typeof seedCycleEvidence>> & {
        representativeUserId: string;
        version: number;
      }
    >();

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
        ['auditor', 'AUDITOR', reviewerOrg.id],
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
      chainId = await provisionChain(prisma, {
        name: 'Workflow chain',
        ownerOrganizationId: farmOrg.id,
        memberOrganizationIds: [transporter.id, retailer.id, reviewerOrg.id],
        grants: [
          { userId: users.farm, organizationId: farmOrg.id, role: 'ORG_ADMIN' },
          {
            userId: users.farm,
            organizationId: farmOrg.id,
            role: 'CHAIN_MANAGER',
          },
          {
            userId: users.farm,
            organizationId: farmOrg.id,
            role: 'FARM_STAFF',
          },
          {
            userId: users.transporter,
            organizationId: transporter.id,
            role: 'ORG_ADMIN',
          },
          {
            userId: users.transporter,
            organizationId: transporter.id,
            role: 'TRANSPORTER',
          },
          {
            userId: users.retailer,
            organizationId: retailer.id,
            role: 'ORG_ADMIN',
          },
          {
            userId: users.retailer,
            organizationId: retailer.id,
            role: 'RETAILER',
          },
          {
            userId: users.reviewer,
            organizationId: reviewerOrg.id,
            role: 'COMPLIANCE_REVIEWER',
          },
          {
            userId: users.auditor,
            organizationId: reviewerOrg.id,
            role: 'AUDITOR',
          },
        ],
      });
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
      const harvest = path.match(/^\/production-cycles\/([^/]+)\/harvests$/);
      const care = path.match(/^\/production-cycles\/([^/]+)\/care$/);
      const evidence = cycleEvidence.get(harvest?.[1] ?? care?.[1] ?? '');
      const payload = evidence
        ? {
            ...(harvest
              ? {
                  version: evidence.version,
                  lotName: 'Workflow harvest',
                  representativeUserId: evidence.representativeUserId,
                  evidenceRef: evidence.harvestEvidenceRef,
                  lotImageEvidenceRef: evidence.lotImageEvidenceRef,
                }
              : {
                  version: evidence.version,
                  name: 'Workflow care record',
                  evidenceRef: evidence.careEvidenceRef,
                }),
            ...body,
          }
        : body;
      return request(app.getHttpServer())
        .post('/api' + path)
        .set('Authorization', bearer(user))
        .set('Idempotency-Key', key)
        .send(payload);
    }
    const farmActor = () => ({
      sub: users.farm,
      organizationId: farmOrgId,
      role: 'FARM_STAFF',
    });

    async function plantedCycle(quantity = 1, targetChainId = chainId) {
      const created = await post('/production-cycles', {
        chainId: targetChainId,
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
      cycleEvidence.set(cycle.id, {
        ...(await seedCycleEvidence(prisma, {
          organizationId: farmOrgId,
          cycleId: cycle.id,
          actorId: users.farm,
        })),
        representativeUserId: users.farm,
        version: 1,
      });
      return { ...cycle, version: 1 };
    }
    async function harvestedLot(quantity = 1, targetChainId = chainId) {
      const cycle = await plantedCycle(quantity, targetChainId);
      const result = await post(`/production-cycles/${cycle.id}/harvests`, {
        quantity,
        unit: 'kg',
        harvestTime: '2026-09-26T00:00:00.000Z',
      }).expect(201);
      return { cycle, ...result.body.data };
    }
    /** Owner plans, every party consents, owner finalizes: the only way to
     * create a Shipment for a chain Lot. Returns the finalized Shipment. */
    async function shipLot(lotId: string, quantity: number | string) {
      const base = `/supply-chains/${chainId}/shipment-plans`;
      const plan = (
        await post(base, {
          lotId,
          transporterOrgId,
          retailerOrgId,
          quantity: Number(quantity).toFixed(3),
          unit: 'kg',
          origin: 'Farm',
          destination: 'Retailer',
        }).expect(201)
      ).body.data;
      for (const [party, user] of [
        ['PRODUCER', 'farm'],
        ['TRANSPORTER', 'transporter'],
        ['RETAILER', 'retailer'],
      ])
        await post(
          `${base}/${plan.id}/accept`,
          {
            party,
            revision: plan.currentRevision,
            payloadDigest: plan.current.payloadDigest,
          },
          user,
        ).expect(201);
      const finalized = (
        await post(`${base}/${plan.id}/finalize`, {
          version: plan.version,
        }).expect(201)
      ).body.data;
      return prisma.shipment.findUniqueOrThrow({
        where: { id: finalized.shipmentId },
      });
    }
    async function startedShipment(quantity = 1) {
      const fixture = await harvestedLot(quantity);
      const shipment = await shipLot(fixture.lot.id, quantity);
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

    it('records server-time care once despite a fast device clock, preserving time audit and journal replay', async () => {
      const cycle = await plantedCycle();
      const key = randomUUID();
      const input = {
        eventTimeSource: 'SERVER_RECEIVED',
        eventTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        careType: 'Tưới nước',
      };
      const before = Date.now();
      const saved = (await post(`/production-cycles/${cycle.id}/care`, input, 'farm', key).expect(201)).body.data;
      expect(new Date(saved.care.eventTime).getTime()).toBeGreaterThanOrEqual(before);
      expect(new Date(saved.care.eventTime).getTime()).toBeLessThanOrEqual(Date.now());
      expect(saved.care.createdAt).toBe(saved.care.eventTime);
      const event = await prisma.traceEvent.findFirstOrThrow({ where: { entityId: saved.care.id, eventType: 'CARE_RECORDED' } });
      expect(event.businessData).toMatchObject({
        eventTimeSource: 'SERVER_RECEIVED', reportedEventTime: input.eventTime,
        receivedAt: saved.care.createdAt,
        reportedTimeOffsetMs: expect.any(Number),
      });
      expect((await post(`/production-cycles/${cycle.id}/care`, input, 'farm', key).expect(201)).body.data).toEqual(saved);
      await post(`/production-cycles/${cycle.id}/care`, { ...input, eventTimeSource: 'DEVICE' }, 'farm', key).expect(409);
      expect(await prisma.careRecord.count({ where: { cycleId: cycle.id } })).toBe(1);
      expect(await prisma.traceEvent.count({ where: { cycleId: cycle.id, eventType: 'CARE_RECORDED' } })).toBe(1);
    });

    it('keeps historical care time and positively journals excessive future-clock rejections without writes', async () => {
      const cycle = await plantedCycle();
      const key = randomUUID();
      const evidence = cycleEvidence.get(cycle.id)!;
      const input = {
        version: 1, name: 'Rejected future care', evidenceRef: evidence.careEvidenceRef,
        eventTimeSource: 'DEVICE', eventTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        careType: 'Tưới nước',
      };
      const failed = await post(`/production-cycles/${cycle.id}/care`, input, 'farm', key).expect(422);
      expect(failed.body.error.message).toContain('quá 2 phút');
      const inspected = await post('/command-requests/status', {
        operation: 'RECORD_CARE', payload: { id: cycle.id, ...input },
      }, 'farm', key).expect(200);
      expect(inspected.body.data).toMatchObject({ status: 'REJECTED', responseStatus: 422 });
      expect(await prisma.careRecord.count({ where: { cycleId: cycle.id } })).toBe(0);
      expect((await prisma.productionCycle.findUniqueOrThrow({ where: { id: cycle.id } })).version).toBe(1);
      expect(await prisma.traceEvent.count({ where: { cycleId: cycle.id, eventType: 'CARE_RECORDED' } })).toBe(0);
      const historical = { ...input, eventTime: '2026-09-26T08:00:00.123Z' };
      const saved = (await post(`/production-cycles/${cycle.id}/care`, historical).expect(201)).body.data;
      expect(saved.care.eventTime).toBe(historical.eventTime);
      expect(new Date(saved.care.createdAt).getTime()).toBeGreaterThan(new Date(saved.care.eventTime).getTime());
    });

    it('uploads cycle photos through the bound PRODUCTION_CYCLE stream without duplicating evidence on replay', async () => {
      const cycle = await plantedCycle();
      const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp3sAAAAASUVORK5CYII=',
        'base64',
      );
      const upload = (user: string, key = randomUUID()) =>
        request(app.getHttpServer())
          .post('/api/enterprise-workspace/evidence')
          .set('Authorization', bearer(user))
          .set('Idempotency-Key', key)
          .field('entityType', 'CYCLE')
          .field('entityId', cycle.id)
          .field('kind', 'CARE_IMAGE')
          .field('description', 'Cycle photo on an isolated simulated binding')
          .attach('file', image, {
            filename: 'cycle.png',
            contentType: 'image/png',
          });
      const count = () =>
        prisma.traceEvidence.count({ where: { entityId: cycle.id } });
      const initialCount = await count();
      expect([403, 404]).toContain((await upload('foreign')).status);
      expect(await count()).toBe(initialCount);
      expect(
        await prisma.traceEvent.count({
          where: { cycleId: cycle.id, eventType: 'EVIDENCE_ATTACHED' },
        }),
      ).toBe(0);

      const key = randomUUID();
      const uploaded = (await upload('farm', key).expect(201)).body.data.record;
      const replay = (await upload('farm', key).expect(201)).body.data.record;
      expect(replay).toEqual(uploaded);
      expect(uploaded.sha256).toBe(
        createHash('sha256').update(image).digest('hex'),
      );
      expect(await count()).toBe(initialCount + 1);
      const events = await prisma.traceEvent.findMany({
        where: { cycleId: cycle.id, eventType: 'EVIDENCE_ATTACHED' },
        include: {
          bindingContext: { include: { binding: true, permissions: true } },
        },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        entityType: 'PRODUCTION_CYCLE',
        entityId: cycle.id,
        actorUserId: users.farm,
        businessData: { evidenceId: uploaded.id, sha256: uploaded.sha256 },
        bindingContext: { binding: { chainId, network: 'simulated-ledger' } },
      });
      expect(privateTraceEvidenceMatches(events[0])).toBe(true);
      expect(
        await prisma.blockchainOutbox.count({
          where: { eventId: events[0].id },
        }),
      ).toBe(1);
    });

    it('lets a PROCESSOR chain member sign a distribution slip with a bound LOT event and replay safely', async () => {
      const processor = await prisma.organization.create({
        data: { name: `Workflow processor ${randomUUID()}`, type: 'PROCESSOR' },
      });
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: 'PROCESSOR' },
      });
      users.processor = (
        await prisma.user.create({
          data: {
            fullName: 'Workflow processor',
            email: `processor-${randomUUID()}@example.test`,
            roleId: role.id,
            organizationId: processor.id,
            passwordHash: 'not-a-login-fixture',
          },
        })
      ).id;
      sessionIds.processor = randomUUID();
      await prisma.refreshSession.create({
        data: {
          id: sessionIds.processor,
          familyId: sessionIds.processor,
          userId: users.processor,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      const distributionChainId = await provisionChain(prisma, {
        ownerOrganizationId: farmOrgId,
        memberOrganizationIds: [processor.id, transporterOrgId],
        grants: [
          { userId: users.farm, organizationId: farmOrgId, role: 'FARM_STAFF' },
          {
            userId: users.processor,
            organizationId: processor.id,
            role: 'ORG_ADMIN',
          },
          {
            userId: users.processor,
            organizationId: processor.id,
            role: 'PROCESSOR',
          },
          {
            userId: users.transporter,
            organizationId: transporterOrgId,
            role: 'TRANSPORTER',
          },
        ],
      });
      for (const inviteeId of [processor.id, transporterOrgId])
        await prisma.enterprisePartner.upsert({
          where: { inviterId_inviteeId: { inviterId: farmOrgId, inviteeId } },
          create: { inviterId: farmOrgId, inviteeId, status: 'ACTIVE' },
          update: {},
        });
      const [senderSite, carrierSite, receiverSite] = await Promise.all(
        [farmOrgId, transporterOrgId, processor.id].map((organizationId) =>
          prisma.enterpriseSite.create({
            data: {
              organizationId,
              name: 'Workflow depot',
              kind: 'WAREHOUSE',
              address: 'Isolated test depot',
            },
          }),
        ),
      );
      const { lot } = await harvestedLot(1, distributionChainId);
      await post('/distribution/allocations', {
        lotId: lot.id,
        siteId: senderSite.id,
        quantity: '1.000',
        unit: 'kg',
        version: lot.version,
        reason: 'Allocate source stock for processor signature regression',
      }).expect(201);
      const transfer = (
        await post('/distribution/transfers', {
          chainId: distributionChainId,
          receiverId: processor.id,
          carrierId: transporterOrgId,
          senderSiteId: senderSite.id,
          carrierSiteId: carrierSite.id,
          receiverSiteId: receiverSite.id,
          origin: 'Workflow farm depot',
          destination: 'Workflow processor depot',
          plannedPickupAt: new Date(Date.now() + 3_600_000).toISOString(),
          lines: [{ lotId: lot.id, quantity: '0.500', unit: 'kg' }],
        }).expect(201)
      ).body.data.record;
      const pair = generateKeyPairSync('ed25519');
      const keyRef = randomUUID();
      const publicKey = pair.publicKey
        .export({ type: 'spki', format: 'der' })
        .toString('base64url');
      const keyBody = { id: keyRef, organizationId: processor.id, publicKey };
      await post(
        '/distribution/keys',
        {
          id: keyRef,
          label: 'Isolated processor regression key',
          publicKey,
          popSignature: sign(
            null,
            Buffer.from(
              `agritrace:distribution-key:1\0${canonicalize(keyBody)}`,
            ),
            pair.privateKey,
          ).toString('base64url'),
        },
        'processor',
      ).expect(201);
      const challenge = (
        await get(
          `/distribution/transfers/${transfer.id}/challenge`,
          'processor',
        ).expect(200)
      ).body.data;
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      const body = {
        snapshotDigest: challenge.snapshotDigest,
        transferId: transfer.id,
        phase: 'CONSENT',
        organizationId: processor.id,
        userId: users.processor,
        keyRef,
        version: String(transfer.version),
        expiresAt,
      };
      const signature = sign(
        null,
        Buffer.from(`${challenge.domain}\0${canonicalize(body)}`),
        pair.privateKey,
      ).toString('base64url');
      const input = {
        version: transfer.version,
        phase: 'CONSENT',
        keyRef,
        expiresAt,
        signature,
      };
      const commandKey = randomUUID();
      const path = `/distribution/transfers/${transfer.id}/sign`;
      const signed = (
        await post(path, input, 'processor', commandKey).expect(201)
      ).body.data.record;
      const replay = (
        await post(path, input, 'processor', commandKey).expect(201)
      ).body.data.record;
      expect(replay).toEqual(signed);
      expect(signed).toMatchObject({
        status: 'PROPOSED',
        version: transfer.version + 1,
      });
      expect(
        await prisma.distributionAttestation.count({
          where: { transferId: transfer.id },
        }),
      ).toBe(1);
      const events = await prisma.traceEvent.findMany({
        where: { lotId: lot.id, actorUserId: users.processor },
        include: {
          bindingContext: {
            include: {
              binding: true,
              permissions: {
                include: { permissionEpoch: { include: { permission: true } } },
              },
            },
          },
        },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        entityType: 'LOT',
        entityId: lot.id,
        eventType: 'DISTRIBUTION_ATTESTED',
        bindingContext: {
          binding: {
            chainId: distributionChainId,
            network: 'simulated-ledger',
          },
        },
      });
      expect(
        events[0].bindingContext?.permissions.map(
          (p) => p.permissionEpoch.permission.role,
        ),
      ).toEqual(['PROCESSOR']);
      expect(privateTraceEvidenceMatches(events[0])).toBe(true);
      expect(
        await prisma.blockchainOutbox.count({
          where: { eventId: events[0].id },
        }),
      ).toBe(1);
      const holding = await prisma.lotHolding.findUniqueOrThrow({
        where: {
          lotId_organizationId: { lotId: lot.id, organizationId: farmOrgId },
        },
      });
      expect(holding.quantity.toFixed(3)).toBe('1.000');
      expect(holding.reserved.toFixed(3)).toBe('0.500');
    });

    it('delivers by the sender itself: invites the receiver, joins on acceptance and needs only two signers', async () => {
      const receiver = await prisma.organization.create({
        data: { name: `Self delivery receiver ${randomUUID()}`, type: 'PROCESSOR' },
      });
      const role = await prisma.role.findUniqueOrThrow({ where: { code: 'PROCESSOR' } });
      users.selfReceiver = (
        await prisma.user.create({
          data: {
            fullName: 'Self delivery receiver',
            email: `self-receiver-${randomUUID()}@example.test`,
            roleId: role.id,
            organizationId: receiver.id,
            passwordHash: 'not-a-login-fixture',
          },
        })
      ).id;
      sessionIds.selfReceiver = randomUUID();
      await prisma.refreshSession.create({
        data: {
          id: sessionIds.selfReceiver,
          familyId: sessionIds.selfReceiver,
          userId: users.selfReceiver,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      // The receiver is only a partner: it is not a member of the lot's chain.
      const selfChainId = await provisionChain(prisma, {
        ownerOrganizationId: farmOrgId,
        memberOrganizationIds: [],
        grants: [
          { userId: users.farm, organizationId: farmOrgId, role: 'FARM_STAFF' },
          { userId: users.farm, organizationId: farmOrgId, role: 'ORG_ADMIN' },
          { userId: users.selfReceiver, organizationId: receiver.id, role: 'ORG_ADMIN' },
        ],
      });
      await prisma.enterprisePartner.upsert({
        where: { inviterId_inviteeId: { inviterId: farmOrgId, inviteeId: receiver.id } },
        create: { inviterId: farmOrgId, inviteeId: receiver.id, status: 'ACTIVE' },
        update: {},
      });
      const [senderSite, receiverSite] = await Promise.all(
        [farmOrgId, receiver.id].map((organizationId) =>
          prisma.enterpriseSite.create({
            data: { organizationId, name: 'Self delivery depot', kind: 'WAREHOUSE', address: 'Isolated test depot' },
          }),
        ),
      );
      const { lot } = await harvestedLot(1, selfChainId);
      await post('/distribution/allocations', {
        lotId: lot.id,
        siteId: senderSite.id,
        quantity: '1.000',
        unit: 'kg',
        version: lot.version,
        reason: 'Allocate source stock for self delivery regression',
      }).expect(201);
      // Platform carriers stay independent; a self delivery names no carrier.
      await post('/distribution/transfers', {
        transportMode: 'PLATFORM_CARRIER',
        carrierId: receiver.id,
        carrierSiteId: receiverSite.id,
        receiverId: receiver.id,
        senderSiteId: senderSite.id,
        receiverSiteId: receiverSite.id,
        origin: 'Self delivery farm',
        destination: 'Self delivery receiver',
        plannedPickupAt: new Date(Date.now() + 3_600_000).toISOString(),
        lines: [{ lotId: lot.id, quantity: '0.600', unit: 'kg' }],
      }).expect(422);
      let transfer = (
        await post('/distribution/transfers', {
          transportMode: 'SELF_DELIVERY',
          transportDetails: { registration: '51C-123.45', driverName: 'Tài xế nông trại' },
          receiverId: receiver.id,
          senderSiteId: senderSite.id,
          receiverSiteId: receiverSite.id,
          origin: 'Self delivery farm',
          destination: 'Self delivery receiver',
          plannedPickupAt: new Date(Date.now() + 3_600_000).toISOString(),
          lines: [{ lotId: lot.id, quantity: '0.600', unit: 'kg' }],
        }).expect(201)
      ).body.data.record;
      expect(transfer).toMatchObject({
        chainId: selfChainId,
        carrierId: farmOrgId,
        carrierSiteId: senderSite.id,
        transportMode: 'SELF_DELIVERY',
      });
      expect(
        await prisma.chainMembership.findUniqueOrThrow({
          where: { chainId_organizationId: { chainId: selfChainId, organizationId: receiver.id } },
        }),
      ).toMatchObject({ status: 'INVITED' });

      const keys: Record<string, { keyRef: string; privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'] }> = {};
      for (const [actor, organizationId] of [['farm', farmOrgId], ['selfReceiver', receiver.id]] as const) {
        const pair = generateKeyPairSync('ed25519');
        const keyRef = randomUUID();
        const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
        await post(
          '/distribution/keys',
          {
            id: keyRef,
            label: 'Isolated self delivery key',
            publicKey,
            popSignature: sign(
              null,
              Buffer.from(`agritrace:distribution-key:1\0${canonicalize({ id: keyRef, organizationId, publicKey })}`),
              pair.privateKey,
            ).toString('base64url'),
          },
          actor,
        ).expect(201);
        keys[actor] = { keyRef, privateKey: pair.privateKey };
      }
      const signPhase = async (actor: 'farm' | 'selfReceiver', organizationId: string, phase: string) => {
        const challengeResponse = await get(`/distribution/transfers/${transfer.id}/challenge`, actor);
        if (challengeResponse.status !== 200) return challengeResponse;
        const challenge = challengeResponse.body.data;
        const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
        const body = {
          snapshotDigest: challenge.snapshotDigest,
          transferId: transfer.id,
          phase,
          organizationId,
          userId: users[actor],
          keyRef: keys[actor].keyRef,
          version: String(transfer.version),
          expiresAt,
        };
        const signature = sign(null, Buffer.from(`${challenge.domain}\0${canonicalize(body)}`), keys[actor].privateKey).toString('base64url');
        return post(`/distribution/transfers/${transfer.id}/sign`, { version: transfer.version, phase, keyRef: keys[actor].keyRef, expiresAt, signature }, actor);
      };
      // An invited receiver must accept the chain before it can sign.
      const early = await signPhase('selfReceiver', receiver.id, 'CONSENT');
      expect(early.status, JSON.stringify(early.body)).toBe(403);
      const joinResponse = await post(`/distribution/transfers/${transfer.id}/join-chain`, { version: transfer.version }, 'selfReceiver');
      expect(joinResponse.status, JSON.stringify(joinResponse.body)).toBe(201);
      const joined = joinResponse.body.data.record;
      expect(joined).toMatchObject({ membership: 'ACTIVE', roleGranted: true });
      expect(
        await prisma.scopedRoleGrant.count({
          where: { chainId: selfChainId, userId: users.selfReceiver, role: 'PROCESSOR', revokedAt: null },
        }),
      ).toBe(1);
      await confirmSimulatedPermissions(prisma, { guard: false });

      for (const [actor, organizationId] of [['selfReceiver', receiver.id], ['farm', farmOrgId]] as const) {
        const consent = await signPhase(actor, organizationId, 'CONSENT');
        expect(consent.status, JSON.stringify(consent.body)).toBe(201);
        transfer = consent.body.data.record;
      }
      expect(transfer.status).toBe('READY');
      // The sender carries the goods: it alone signs the pickup.
      const pickup = await signPhase('farm', farmOrgId, 'PICKUP');
      expect(pickup.status, JSON.stringify(pickup.body)).toBe(201);
      transfer = pickup.body.data.record;
      expect(transfer.status).toBe('IN_TRANSIT');
      const sent = await prisma.lotHolding.findUniqueOrThrow({
        where: { lotId_organizationId: { lotId: lot.id, organizationId: farmOrgId } },
      });
      expect(sent.quantity.toFixed(3)).toBe('0.400');
      await post(`/distribution/transfers/${transfer.id}/receipt`, {
        version: transfer.version,
        reason: 'Đã kiểm đếm đủ lượng giao tại kho nhận',
        lines: [{ lotId: lot.id, received: '0.600', rejected: '0', quarantined: '0' }],
      }, 'selfReceiver').expect(201);
      transfer = (await get(`/distribution/transfers/${transfer.id}`, 'selfReceiver').expect(200)).body.data.record;
      for (const [actor, organizationId] of [['farm', farmOrgId], ['selfReceiver', receiver.id]] as const) {
        const delivery = await signPhase(actor, organizationId, 'DELIVERY');
        expect(delivery.status, JSON.stringify(delivery.body)).toBe(201);
        transfer = delivery.body.data.record;
      }
      expect(transfer.status).toBe('DELIVERED');
      const received = await prisma.lotHolding.findUniqueOrThrow({
        where: { lotId_organizationId: { lotId: lot.id, organizationId: receiver.id } },
      });
      expect(received.quantity.toFixed(3)).toBe('0.600');
      expect(
        await prisma.distributionAttestation.count({ where: { transferId: transfer.id } }),
      ).toBe(5);

      // The receiver asks to collect more; the sender turns one request into a
      // pickup transfer and declines the other. Requests never reserve stock.
      const ask = (note: string) =>
        post('/distribution/pickup-requests', { senderId: farmOrgId, note }, 'selfReceiver').expect(201);
      const wanted = (await ask('Lấy thêm 0,2 kg xoài')).body.data.record;
      const extra = (await ask('Lấy thêm hàng tuần sau')).body.data.record;
      const base = {
        receiverId: receiver.id,
        senderSiteId: senderSite.id,
        receiverSiteId: receiverSite.id,
        origin: 'Self delivery farm',
        destination: 'Receiver collects',
        plannedPickupAt: new Date(Date.now() + 3_600_000).toISOString(),
        lines: [{ lotId: lot.id, quantity: '0.200', unit: 'kg' }],
      };
      await post('/distribution/transfers', { ...base, transportMode: 'EXTERNAL_CARRIER', externalHirer: 'RECEIVER' }).expect(422);
      await post('/distribution/transfers', { ...base, transportMode: 'SELF_DELIVERY', pickupRequestId: wanted.id }).expect(409);
      const collected = (
        await post('/distribution/transfers', { ...base, transportMode: 'RECEIVER_PICKUP', pickupRequestId: wanted.id }).expect(201)
      ).body.data.record;
      expect(collected).toMatchObject({ carrierId: receiver.id, carrierSiteId: receiverSite.id, transportMode: 'RECEIVER_PICKUP' });
      expect(await prisma.distributionPickupRequest.findUniqueOrThrow({ where: { id: wanted.id } })).toMatchObject({
        status: 'ACCEPTED',
        transferId: collected.id,
      });
      await post(`/distribution/pickup-requests/${extra.id}/decline`, { version: extra.version }, 'selfReceiver').expect(404);
      await post(`/distribution/pickup-requests/${extra.id}/decline`, { version: extra.version, note: 'Hết hàng tuần sau' }).expect(201);
      expect(await prisma.distributionPickupRequest.findUniqueOrThrow({ where: { id: extra.id } })).toMatchObject({ status: 'DECLINED' });
      const hired = (
        await post('/distribution/transfers', {
          ...base,
          lines: [{ lotId: lot.id, quantity: '0.100', unit: 'kg' }],
          transportMode: 'EXTERNAL_CARRIER',
          externalHirer: 'RECEIVER',
          transportDetails: { carrierName: 'Xe tải Minh Phát', registration: '60C-555.66' },
        }).expect(201)
      ).body.data.record;
      expect(hired).toMatchObject({ carrierId: receiver.id, transportDetails: { carrierName: 'Xe tải Minh Phát' } });
    });

    it('keeps a linear hash chain when business timestamps are backdated or tied', async () => {
      const db = prisma as unknown as PrismaService;
      const trace = new TraceService(db, new OrganizationAccessService(db));
      // Every event belongs to a bound cycle and an actor with a ledger grant.
      const cycle = await plantedCycle();
      const entityId = randomUUID();
      const events = [];
      for (const eventTime of ['2026-09-28', '2026-09-25', '2026-09-25']) {
        events.push(
          await prisma.$transaction((tx) =>
            trace.createInTransaction(tx, {
              entityType: 'LOT',
              entityId,
              cycleId: cycle.id,
              eventType: 'TEST_CHECKPOINT',
              eventTime: new Date(eventTime),
              actor: farmActor(),
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
        // Out-of-scope and absent resources share one 404 response.
        await get(path, 'foreign').expect(404);
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
        chainId,
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
      await get(`/trace/events/${event.id}/proof`, 'foreign').expect(404);
    });

    it('keeps sibling harvest events out of a lot timeline while retaining cycle history', async () => {
      const cycle = await plantedCycle(2);
      const harvest = async (harvestTime: string) =>
        (
          await post(`/production-cycles/${cycle.id}/harvests`, {
            version: harvestTime === '2026-09-26T00:00:00.000Z' ? 1 : 2,
            quantity: 0.5,
            unit: 'kg',
            harvestTime,
          }).expect(201)
        ).body.data;
      const first = await harvest('2026-09-26T00:00:00.000Z');
      const sibling = await harvest('2026-09-27T00:00:00.000Z');
      await shipLot(first.lot.id, 0.5);
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
        404,
      );
    });

    it('does not label the lot verified when an earlier cycle event is pending or failed', async () => {
      const { lot, cycle, traceQr } = await harvestedLot();
      const events = await prisma.traceEvent.findMany({
        where: { OR: [{ lotId: lot.id }, { cycleId: cycle.id, lotId: null }] },
        orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      });
      const confirm = async (event: (typeof events)[number]) => {
        // A proof names the destination fixed by the event's own route.
        const { definition } = await prisma.eventLedgerRoute.findUniqueOrThrow({
          where: { eventId: event.id },
          include: { definition: true },
        });
        return prisma.blockchainProof.create({
          data: {
            eventId: event.id,
            dataHash: event.dataHash,
            network: definition.network,
            txId: randomBytes(32).toString('hex'),
            channelId: definition.channelId,
            recordedAt: new Date(),
            transactionStatus: 'CONFIRMED',
          },
        });
      };
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
      const cycle = await plantedCycle();
      const entityId = randomUUID();
      await Promise.all(
        [0, 1, 2].map((sequence) =>
          prisma.$transaction((tx) =>
            trace.createInTransaction(tx, {
              entityType: 'LOT',
              entityId,
              cycleId: cycle.id,
              eventType: 'CONCURRENT_CHECKPOINT',
              actor: farmActor(),
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

    it('records sensor readings only off-chain', async () => {
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
      // Several window digests share the shipment: detail and list expose the
      // chain head, then the final digest, never an arbitrary window (V01).
      const exposed = async () => {
        const detail = (
          await get(`/shipments/${shipment.id}`, 'transporter').expect(200)
        ).body.data.telemetryDigest;
        const listed = (
          await get('/shipments', 'transporter').expect(200)
        ).body.data.find(
          (item: { id: string }) => item.id === shipment.id,
        ).telemetryDigest;
        expect(listed?.id).toBe(detail?.id);
        return detail;
      };
      expect((await exposed()).id).toBe(digests[2].id);
      const final = (
        await post(
          `/iot/shipments/${shipment.id}/telemetry-digests`,
          {
            periodStart: new Date(timestamp.getTime() - 4000).toISOString(),
            periodEnd: timestamp.toISOString(),
            isFinal: true,
          },
          'transporter',
        ).expect(201)
      ).body.data;
      const head = await exposed();
      expect(head.id).toBe(final.id);
      expect(head.isFinal).toBe(true);
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
      await get(`/shipments/${shipment.id}`, 'foreign').expect(404);
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
        // Platform admins manage master data, not private business records.
        if (user === 'admin') {
          await get(`/lots/${lot.id}`, user).expect(404);
          return;
        }
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
      const lotEvents = await prisma.traceEvent.findMany({
        where: { lotId },
        select: { eventType: true },
        orderBy: { eventType: 'asc' },
      });
      expect(lotEvents.map((event) => event.eventType)).toEqual([
        'EVIDENCE_ATTACHED',
        'HARVEST_RECORDED',
        'SENSOR_DIGEST_FINALIZED',
      ]);
      expect(
        await prisma.blockchainOutbox.count({
          where: { traceEvent: { lotId } },
        }),
      ).toBe(lotEvents.length);
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
      await prisma.scopedRoleGrant.create({
        data: {
          userId: colleague.id,
          organizationId: farmOrgId,
          chainId,
          scope: 'CHAIN',
          role: 'FARM_STAFF',
        },
      });
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
          version: 2,
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
      }).expect(403);
    });

    it('lets one enterprise with three capabilities run the whole core flow itself (HYB-AC-01)', async () => {
      const org = await prisma.organization.create({
        data: { name: `Integrated ${randomUUID()}`, type: 'FARM' },
      });
      for (const code of ['TRANSPORTER', 'RETAILER'] as const)
        await prisma.organizationCapability.create({
          data: { organizationId: org.id, code },
        });
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: 'FARM_STAFF' },
      });
      const user = await prisma.user.create({
        data: {
          fullName: 'Integrated operator',
          email: `integrated-${randomUUID()}@example.test`,
          roleId: role.id,
          organizationId: org.id,
          passwordHash: 'not-a-login-fixture',
        },
      });
      users.integrated = user.id;
      sessionIds.integrated = randomUUID();
      await prisma.refreshSession.create({
        data: {
          id: sessionIds.integrated,
          familyId: sessionIds.integrated,
          userId: user.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      const integratedChain = await provisionChain(prisma, {
        name: 'Integrated chain',
        ownerOrganizationId: org.id,
        memberOrganizationIds: [],
        grants: (
          [
            'ORG_ADMIN',
            'CHAIN_MANAGER',
            'FARM_STAFF',
            'TRANSPORTER',
            'RETAILER',
          ] as const
        ).map((r) => ({ userId: user.id, organizationId: org.id, role: r })),
      });
      const farm = await prisma.farm.create({
        data: { organizationId: org.id, name: 'Integrated farm' },
      });
      const as = 'integrated';
      const cycle = (
        await post(
          '/production-cycles',
          {
            chainId: integratedChain,
            farmId: farm.id,
            productId,
            cycleCode: 'INTEGRATED-' + randomUUID(),
            maxHarvestQuantity: 2,
            harvestUnit: 'kg',
          },
          as,
        ).expect(201)
      ).body.data;
      await post(
        `/production-cycles/${cycle.id}/plant`,
        { version: 0, plantedAt: '2026-09-25T00:00:00.000Z' },
        as,
      ).expect(201);
      cycleEvidence.set(cycle.id, {
        ...(await seedCycleEvidence(prisma, {
          organizationId: org.id,
          cycleId: cycle.id,
          actorId: user.id,
        })),
        representativeUserId: user.id,
        version: 1,
      });
      const { lot } = (
        await post(
          `/production-cycles/${cycle.id}/harvests`,
          { quantity: 2, unit: 'kg', harvestTime: '2026-09-26T00:00:00.000Z' },
          as,
        ).expect(201)
      ).body.data;
      const base = `/supply-chains/${integratedChain}/shipment-plans`;
      const plan = (
        await post(
          base,
          {
            lotId: lot.id,
            transporterOrgId: org.id,
            retailerOrgId: org.id,
            quantity: '2.000',
            unit: 'kg',
            origin: 'Own farm',
            destination: 'Own shop',
          },
          as,
        ).expect(201)
      ).body.data;
      for (const party of ['PRODUCER', 'TRANSPORTER', 'RETAILER'])
        await post(
          `${base}/${plan.id}/accept`,
          {
            party,
            revision: plan.currentRevision,
            payloadDigest: plan.current.payloadDigest,
          },
          as,
        ).expect(201);
      const { shipmentId } = (
        await post(
          `${base}/${plan.id}/finalize`,
          { version: plan.version },
          as,
        ).expect(201)
      ).body.data;
      await post(
        `/shipments/${shipmentId}/start`,
        { version: 0, lotVersion: 0 },
        as,
      ).expect(201);
      await post(
        `/shipments/${shipmentId}/arrive`,
        { version: 1, lotVersion: 1 },
        as,
      ).expect(201);
      await post(
        `/shipments/${shipmentId}/receive`,
        { version: 2, lotVersion: 2, receivedQuantity: 2 },
        as,
      ).expect(201);
      const events = await prisma.traceEvent.findMany({
        where: { lotId: lot.id },
        select: { actorRole: true, eventType: true },
        orderBy: { serverRecordedAt: 'asc' },
      });
      // The server chose the stage role for each command, not the global role.
      expect(events.map((e) => e.actorRole)).toEqual(
        expect.arrayContaining(['FARM_STAFF', 'TRANSPORTER', 'RETAILER']),
      );
      expect(
        await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } }),
      ).toMatchObject({ currentState: 'RETAIL_RECEIVED' });
    });

    it('validates malformed identifiers and blank master-data names at the HTTP boundary', async () => {
      await get('/inspections?lotId=not-a-uuid').expect(400);
      await get('/certificates?cycleId=not-a-uuid').expect(400);
      await post('/catalog/products', { productName: '   ' }, 'farm').expect(
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
          roleCode: 'FARM_STAFF',
          organizationId: farmOrgId,
        },
        'admin',
      ).expect(400);
    });

    it('keeps admin out of enterprise catalog writes and direct business-account creation', async () => {
      await get('/catalog', 'admin').expect(200);
      await post(
        '/catalog/products',
        { productName: 'Admin-only product' },
        'admin',
      ).expect(403);
      await post(
        '/catalog/farms',
        { organizationId: farmOrgId, name: 'Admin-only farm' },
        'admin',
      ).expect(403);
      await post(
        '/catalog/plots',
        { farmId, name: 'Admin-only plot' },
        'admin',
      ).expect(403);
      await post(
        '/organizations',
        { name: 'Bypassed farm', type: 'FARM' },
        'admin',
      ).expect(400);
      await post(
        '/users',
        {
          email: `bypassed-${randomUUID()}@example.test`,
          fullName: 'Bypassed employee',
          roleCode: 'FARM_STAFF',
          organizationId: farmOrgId,
        },
        'admin',
      ).expect(403);
      await request(app.getHttpServer())
        .patch(`/api/users/${users.farm}/status`)
        .set('Authorization', bearer('admin'))
        .set('Idempotency-Key', randomUUID())
        .send({
          accountStatus: 'LOCKED',
          version: 0,
          reason: 'Thử khóa tài khoản doanh nghiệp từ nền tảng',
        })
        .expect(403);
      const roles = await get('/users/roles', 'admin').expect(200);
      expect(
        roles.body.data.map((role: { code: string }) => role.code),
      ).toEqual([
        'COMPLIANCE_REVIEWER',
        'PLATFORM_CASE_MANAGER',
        'PLATFORM_OPERATOR',
        'PLATFORM_PRIVACY_OFFICER',
        'SYSTEM_ADMIN',
      ]);
      const auditor = await post(
        '/organizations',
        {
          name: `Independent auditor ${randomUUID()}`,
          type: 'AUDITOR',
        },
        'admin',
      ).expect(201);
      await post(
        '/users',
        {
          email: `independent-reviewer-${randomUUID()}@example.test`,
          fullName: 'Independent reviewer',
          roleCode: 'COMPLIANCE_REVIEWER',
          organizationId: auditor.body.data.id,
        },
        'admin',
      ).expect(201);
    });
  },
);
