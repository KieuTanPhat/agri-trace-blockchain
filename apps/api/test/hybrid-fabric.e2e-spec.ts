import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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
import { BindingConnectionPool } from '../src/modules/ledger/binding-pool.js';
import { BindingDeliveryService } from '../src/modules/ledger/binding-delivery.service.js';
import { LedgerControlService } from '../src/modules/ledger/ledger-control.service.js';
import {
  activateBinding,
  registerBinding,
} from '../src/modules/ledger/ledger-bindings.js';
import {
  mirrorCredential,
  onboardBindingOnLedger,
} from '../src/modules/ledger/ledger-onboarding.js';
import { provisionChain } from './support/chain-scope.js';
import {
  CHAINCODE,
  CONTRACT,
  WRITER_AUTHORITY,
  closePilotConnections,
  pilotClient,
  pilotDocker,
  pilotOperator,
  writeBindingsConfig,
} from './support/fabric-pilot.js';

const enabled =
  process.env.HYBRID_FABRIC_E2E === '1' && !!process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.TEST_DATABASE_URL ?? 'postgresql://unused@localhost/unused',
  }),
});

interface World {
  label: string;
  channel: 'hybrid-b' | 'hybrid-self';
  owner: 'org2' | 'org3';
  chainId: string;
  bindingDigest: string;
  chainRef: string;
  farmId: string;
  users: Record<'farm' | 'transporter' | 'retailer', string>;
  orgs: Record<'farm' | 'transporter' | 'retailer', string>;
  sessions: Record<'farm' | 'transporter' | 'retailer', string>;
}

(enabled ? describe : describe.skip)(
  'Release B on the real three-organization Fabric pilot',
  () => {
    let app: INestApplication;
    let jwt: JwtService;
    let productId: string;
    let delivery: BindingDeliveryService;
    let control: LedgerControlService;
    let pool: BindingConnectionPool;
    const worlds: Record<string, World> = {};

    const post = (
      w: World,
      path: string,
      body: object,
      who: keyof World['users'] = 'farm',
    ) =>
      request(app.getHttpServer())
        .post('/api' + path)
        .set(
          'Authorization',
          `Bearer ${jwt.sign({ sub: w.users[who], sid: w.sessions[who] })}`,
        )
        .set('Idempotency-Key', randomUUID())
        .send(body);
    const get = (w: World, path: string, who: keyof World['users'] = 'farm') =>
      request(app.getHttpServer())
        .get('/api' + path)
        .set(
          'Authorization',
          `Bearer ${jwt.sign({ sub: w.users[who], sid: w.sessions[who] })}`,
        );

    /** Skip backoff timers so rounds do not wait in real time. */
    async function expedite() {
      await prisma.$executeRaw`UPDATE blockchain_outbox SET next_attempt_at = now() WHERE status IN ('RETRY','PENDING')`;
      await prisma.$executeRaw`UPDATE ledger_control_job SET next_attempt_at = now() WHERE status = 'PENDING'`;
    }
    async function settle(done: () => Promise<boolean>, rounds = 30) {
      for (let i = 0; i < rounds; i += 1) {
        await control.processAll();
        await delivery.processAll();
        if (await done()) return;
        await expedite();
        await new Promise((r) => setTimeout(r, 400));
      }
      throw new Error('system did not settle');
    }
    const unconfirmed = (w: World) => async () =>
      (await prisma.blockchainOutbox.count({
        where: {
          status: { not: 'COMPLETED' },
          traceEvent: { chainContext: { chainId: w.chainId } },
        },
      })) === 0;
    const permissionsActive = (w: World) => async () =>
      (await prisma.ledgerPermissionSync.count({
        where: {
          permission: { binding: { digest: w.bindingDigest } },
          state: { not: 'ACTIVE' },
        },
      })) === 0;

    async function createWorld(
      label: string,
      channel: World['channel'],
      owner: World['owner'],
    ): Promise<World> {
      const make = async (type: 'FARM' | 'TRANSPORTER' | 'RETAILER') =>
        prisma.organization.create({
          data: { name: `${label} ${type} ${randomUUID()}`, type },
        });
      const orgs = {
        farm: await make('FARM'),
        transporter: await make('TRANSPORTER'),
        retailer: await make('RETAILER'),
      };
      const users = {} as World['users'];
      const sessions = {} as World['sessions'];
      for (const [key, code] of [
        ['farm', 'FARM_STAFF'],
        ['transporter', 'TRANSPORTER'],
        ['retailer', 'RETAILER'],
      ] as const) {
        const role = await prisma.role.upsert({
          where: { code },
          create: { code, name: code },
          update: {},
        });
        users[key] = (
          await prisma.user.create({
            data: {
              fullName: `${label} ${key}`,
              email: `${label}-${key}-${randomUUID()}@example.test`,
              roleId: role.id,
              organizationId: orgs[key].id,
              passwordHash: 'not-a-login-fixture',
            },
          })
        ).id;
        sessions[key] = randomUUID();
        await prisma.refreshSession.create({
          data: {
            id: sessions[key],
            familyId: sessions[key],
            userId: users[key],
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
          },
        });
      }
      const farm = await prisma.farm.create({
        data: { organizationId: orgs.farm.id, name: `${label} farm` },
      });
      const chainId = await provisionChain(prisma, {
        name: `${label} chain`,
        ownerOrganizationId: orgs.farm.id,
        memberOrganizationIds: [orgs.transporter.id, orgs.retailer.id],
        grants: [
          {
            userId: users.farm,
            organizationId: orgs.farm.id,
            role: 'ORG_ADMIN',
          },
          {
            userId: users.farm,
            organizationId: orgs.farm.id,
            role: 'CHAIN_MANAGER',
          },
          {
            userId: users.farm,
            organizationId: orgs.farm.id,
            role: 'FARM_STAFF',
          },
          {
            userId: users.transporter,
            organizationId: orgs.transporter.id,
            role: 'ORG_ADMIN',
          },
          {
            userId: users.transporter,
            organizationId: orgs.transporter.id,
            role: 'TRANSPORTER',
          },
          {
            userId: users.retailer,
            organizationId: orgs.retailer.id,
            role: 'ORG_ADMIN',
          },
          {
            userId: users.retailer,
            organizationId: orgs.retailer.id,
            role: 'RETAILER',
          },
        ],
      });
      // Ledger onboarding by the operators (not through any business endpoint).
      const ledger = await pilotOperator(channel, owner);
      const health = (await ledger.reader.health()) as {
        governanceDigest: string;
      };
      const registered = await prisma.$transaction((tx) =>
        registerBinding(tx, {
          chainId,
          network: 'agritrace-hybrid-local',
          channelId: channel,
          chaincodeName: CHAINCODE,
          contractName: CONTRACT,
          writerAuthority: WRITER_AUTHORITY,
          writerMspId: 'Org1MSP',
          governanceDigest: health.governanceDigest,
          profile: owner === 'org2' ? 'MANAGED_ORG' : 'SELF_MANAGED_ORG',
        }),
      );
      await onboardBindingOnLedger({
        operator: ledger.operator,
        reader: ledger.reader,
        channelId: channel,
        approvers: ledger.approvers,
        binding: {
          digest: registered.digest,
          network: 'agritrace-hybrid-local',
          chaincodeName: CHAINCODE,
          contractName: CONTRACT,
          chainRef: registered.chainRef,
          writerAuthority: WRITER_AUTHORITY,
          writerMspId: 'Org1MSP',
          governanceDigest: health.governanceDigest,
        },
        relayerFingerprint: ledger.relayerFingerprint,
      });
      await prisma.$transaction((tx) =>
        mirrorCredential(tx, registered.digest, ledger.relayerFingerprint),
      );
      return {
        label,
        channel,
        owner,
        chainId,
        bindingDigest: registered.digest,
        chainRef: registered.chainRef,
        farmId: farm.id,
        users,
        orgs: {
          farm: orgs.farm.id,
          transporter: orgs.transporter.id,
          retailer: orgs.retailer.id,
        },
        sessions,
      };
    }

    beforeAll(async () => {
      productId = (
        await prisma.product.create({
          data: { productName: 'Hybrid B vegetables', defaultUnit: 'kg' },
        })
      ).id;
      worlds.b = await createWorld('hb', 'hybrid-b', 'org2');
      worlds.self = await createWorld('hs', 'hybrid-self', 'org3');
      const file = writeBindingsConfig([
        worlds.b.bindingDigest,
        worlds.self.bindingDigest,
      ]);
      const config = new ConfigService({
        FABRIC_MAX_RETRIES: '8',
        FABRIC_CLAIM_LEASE_MS: '120000',
      });
      pool = new BindingConnectionPool();
      pool.environment = { FABRIC_BINDINGS_CONFIG: file };
      const service = prisma as unknown as PrismaService;
      delivery = new BindingDeliveryService(service, config, pool);
      control = new LedgerControlService(service, config, pool);
      const fixture = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(ConfigService)
        .useValue({
          getOrThrow: () => 'hybrid-fabric-e2e-secret',
          get: (_k: string, f: unknown) => f,
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
      // Activation queues every valid chain grant for ledger confirmation.
      for (const w of [worlds.b, worlds.self])
        await prisma.$transaction((tx) => activateBinding(tx, w.bindingDigest));
      for (const w of [worlds.b, worlds.self])
        await settle(permissionsActive(w));
    }, 240_000);

    afterAll(async () => {
      await app?.close();
      pool?.onModuleDestroy();
      closePilotConnections();
      await prisma.$disconnect();
    });

    async function cycleFlow(w: World, quantity = 1) {
      const cycle = (
        await post(w, '/production-cycles', {
          chainId: w.chainId,
          farmId: w.farmId,
          productId,
          cycleCode: `C-${randomUUID()}`,
          maxHarvestQuantity: quantity,
          harvestUnit: 'kg',
        }).expect(201)
      ).body.data;
      return cycle as { id: string };
    }

    it('confirms every granted permission on the ledger before it opens any write', async () => {
      for (const w of [worlds.b, worlds.self]) {
        const syncs = await prisma.ledgerPermissionSync.findMany({
          where: { permission: { binding: { digest: w.bindingDigest } } },
          include: { permission: true },
        });
        // farm staff, chain manager, transporter, retailer
        expect(syncs.length).toBe(4);
        for (const sync of syncs) {
          expect(sync).toMatchObject({
            state: 'ACTIVE',
            confirmedEpoch: 1,
            requestedEpoch: 1,
          });
        }
        const reader = (await pilotClient('org1', 'relayer', w.channel)).client;
        const onLedger = (await reader.getRegistryPermission(
          syncs[0].permissionRef,
        )) as { status: string; epoch: string };
        expect(onLedger).toMatchObject({ status: 'ACTIVE', epoch: '1' });
      }
    });

    it('records a cycle as a B event: commitment hash, captured epoch, route pinned to the binding', async () => {
      const w = worlds.b;
      const cycle = await cycleFlow(w);
      const event = await prisma.traceEvent.findFirstOrThrow({
        where: { cycleId: cycle.id, entityType: 'PRODUCTION_CYCLE' },
        include: {
          bindingContext: { include: { permissions: true } },
          ledgerRoute: { include: { definition: true } },
        },
      });
      expect(event.schemaVersion).toBe('3.0.0');
      expect(event.bindingContext?.permissions).toHaveLength(1);
      expect(event.ledgerRoute?.definition.bindingDigest).toBe(w.bindingDigest);
      const before = await get(w, `/trace/events/${event.id}/proof`).expect(
        200,
      );
      expect(before.body.data).toMatchObject({
        transactionStatus: 'PENDING',
        localHashMatches: true,
        channelId: 'hybrid-b',
      });
      await settle(unconfirmed(w));
      const after = await get(w, `/trace/events/${event.id}/proof`).expect(200);
      expect(after.body.data).toMatchObject({
        transactionStatus: 'CONFIRMED',
        localHashMatches: true,
        channelId: 'hybrid-b',
      });
      const ledger = (await (
        await pilotClient('org1', 'relayer', 'hybrid-b')
      ).client.getBindingProof(w.chainRef, event.id)) as {
        dataHash: string;
        txId: string;
      };
      expect(ledger.dataHash).toBe(event.dataHash);
      expect(ledger.txId).toBe(after.body.data.txId);
    });

    /** Owner plans, every party consents, owner finalizes. */
    async function shipLot(w: World, lotId: string, quantity: number) {
      const base = `/supply-chains/${w.chainId}/shipment-plans`;
      const plan = (
        await post(w, base, {
          lotId,
          transporterOrgId: w.orgs.transporter,
          retailerOrgId: w.orgs.retailer,
          quantity: quantity.toFixed(3),
          unit: 'kg',
          origin: 'Farm',
          destination: 'Shop',
        }).expect(201)
      ).body.data;
      for (const [party, who] of [
        ['PRODUCER', 'farm'],
        ['TRANSPORTER', 'transporter'],
        ['RETAILER', 'retailer'],
      ] as const)
        await post(
          w,
          `${base}/${plan.id}/accept`,
          {
            party,
            revision: plan.currentRevision,
            payloadDigest: plan.current.payloadDigest,
          },
          who,
        ).expect(201);
      const done = (
        await post(w, `${base}/${plan.id}/finalize`, {
          version: plan.version,
        }).expect(201)
      ).body.data;
      return done.shipmentId as string;
    }

    it('carries the whole business flow on the ledger and verifies the public QR trace', async () => {
      const w = worlds.b;
      const cycle = await cycleFlow(w, 2);
      await post(w, `/production-cycles/${cycle.id}/plant`, {
        version: 0,
        plantedAt: '2026-09-25T00:00:00.000Z',
      }).expect(201);
      const harvested = (
        await post(w, `/production-cycles/${cycle.id}/harvests`, {
          quantity: 2,
          unit: 'kg',
          harvestTime: '2026-09-26T00:00:00.000Z',
        }).expect(201)
      ).body.data;
      const shipmentId = await shipLot(w, harvested.lot.id, 2);
      await post(
        w,
        `/shipments/${shipmentId}/start`,
        { version: 0, lotVersion: 0 },
        'transporter',
      ).expect(201);
      await post(
        w,
        `/shipments/${shipmentId}/arrive`,
        { version: 1, lotVersion: 1 },
        'transporter',
      ).expect(201);
      await post(
        w,
        `/shipments/${shipmentId}/receive`,
        { version: 2, lotVersion: 2, receivedQuantity: 2 },
        'retailer',
      ).expect(201);
      await settle(unconfirmed(w), 60);
      const events = await prisma.traceEvent.findMany({
        where: { OR: [{ cycleId: cycle.id }, { lotId: harvested.lot.id }] },
        include: { blockchainProof: true },
      });
      // cycle, planting, harvest, lot, shipment created/started/arrived/received
      expect(events.length).toBeGreaterThanOrEqual(7);
      for (const event of events)
        expect(event.blockchainProof?.transactionStatus).toBe('CONFIRMED');
      const lot = await get(w, `/lots/${harvested.lot.id}`).expect(200);
      expect(JSON.stringify(lot.body.data)).toContain('VERIFIED');
      const token = harvested.traceQr?.traceToken;
      if (token) {
        const publicTrace = await request(app.getHttpServer()).get(
          `/api/public/trace/${token}`,
        );
        expect(publicTrace.status).toBe(200);
        // The public projection exposes verification status, never private evidence.
        const text = JSON.stringify(publicTrace.body);
        expect(text).toContain('VERIFIED');
        expect(text).not.toMatch(
          /privateBodyDigest|bindingDigest|permissionRef|actorAuthProof/,
        );
      }
    }, 240_000);

    it('denies a revoked grant at once, drains behind a barrier, then revokes on the ledger; regrant uses a fresh epoch', async () => {
      const w = worlds.b;
      const grant = await prisma.scopedRoleGrant.findFirstOrThrow({
        where: {
          chainId: w.chainId,
          userId: w.users.transporter,
          role: 'TRANSPORTER',
          revokedAt: null,
        },
      });
      // The transporter has captured events before the revoke; make one pending.
      const sync = () =>
        prisma.ledgerPermissionSync.findFirstOrThrow({
          where: {
            permission: {
              userId: w.users.transporter,
              binding: { digest: w.bindingDigest },
            },
          },
        });
      const ref = (await sync()).permissionRef;
      const revoked = await post(
        w,
        `/organizations/${w.orgs.transporter}/scoped-grants/${grant.id}/revoke`,
        { version: grant.revision, chainId: w.chainId },
        'transporter',
      );
      // Only a platform admin may revoke business grants; use the DB path the API uses.
      if (revoked.status !== 201) {
        await prisma.$transaction(async (tx) => {
          await tx.scopedRoleGrant.update({
            where: { id: grant.id },
            data: { revokedAt: new Date(), revision: { increment: 1 } },
          });
          const { requestLedgerRevoke } =
            await import('../src/modules/ledger/ledger-permissions.js');
          await requestLedgerRevoke(tx, grant.id, 'NORMAL', 'e2e revoke');
        });
      }
      expect((await sync()).state).toBe('REVOKE_REQUESTED');
      // API authority is gone immediately, before any ledger confirmation.
      await get(w, `/shipments`, 'transporter').expect(200);
      await settle(async () => (await sync()).state === 'REVOKED', 30);
      const ledger = (await (
        await pilotClient('org1', 'relayer', w.channel)
      ).client.getRegistryPermission(ref)) as { status: string; epoch: string };
      expect(ledger).toMatchObject({ status: 'REVOKED', epoch: '1' });
      // Regrant: fresh grant row -> epoch 2, confirmed on the ledger before use.
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.scopedRoleGrant.create({
          data: {
            userId: w.users.transporter,
            organizationId: w.orgs.transporter,
            chainId: w.chainId,
            scope: 'CHAIN',
            role: 'TRANSPORTER',
          },
        });
        const { requestLedgerGrant } =
          await import('../src/modules/ledger/ledger-permissions.js');
        await requestLedgerGrant(tx, fresh);
      });
      expect((await sync()).state).toBe('REQUESTED');
      await settle(async () => (await sync()).state === 'ACTIVE', 30);
      expect(await sync()).toMatchObject({
        requestedEpoch: 2,
        confirmedEpoch: 2,
      });
      expect(
        (await (
          await pilotClient('org1', 'relayer', w.channel)
        ).client.getRegistryPermission(ref)) as { epoch: string },
      ).toMatchObject({ epoch: '2' });
    }, 240_000);

    it('keeps an outage of one binding from stopping another and delivers after recovery', async () => {
      const x = worlds.b;
      const y = worlds.self;
      await cycleFlow(y);
      await cycleFlow(x);
      pilotDocker('stop', 'peer0.org3.example.com');
      try {
        // The Org3 peer is required to endorse hybrid-self: Y stays pending, X moves on.
        for (let i = 0; i < 6 && !(await unconfirmed(x)()); i += 1) {
          await delivery.processAll();
          await expedite();
        }
        expect(await unconfirmed(x)()).toBe(true);
        expect(await unconfirmed(y)()).toBe(false);
        const pending = await prisma.blockchainOutbox.findMany({
          where: {
            status: { not: 'COMPLETED' },
            traceEvent: { chainContext: { chainId: y.chainId } },
          },
        });
        expect(pending.length).toBeGreaterThan(0);
        for (const item of pending) expect(item.attemptCount).toBeLessThan(5); // outage spends no retry budget
      } finally {
        pilotDocker('start', 'peer0.org3.example.com');
      }
      await new Promise((r) => setTimeout(r, 12_000));
      pool.invalidate(y.bindingDigest);
      await settle(unconfirmed(y), 60);
    }, 240_000);

    /** Injects a failure around the real submit of the cached Worker connection. */
    async function interceptSubmit(
      w: World,
      mode: { current: 'pass' | 'lost' | 'drop' },
    ) {
      const binding = await prisma.fabricNetworkBinding.findUniqueOrThrow({
        where: { digest: w.bindingDigest },
        include: { state: true },
      });
      const connection = await pool.get(delivery.target(binding), 'relayer');
      const client = connection.client;
      const original = client.recordBindingEvent.bind(client);
      client.recordBindingEvent = ((
        event: string,
        deliveryJson: string,
        orgs?: string[],
      ) => {
        const prepared = original(event, deliveryJson, orgs);
        return {
          get transactionId() {
            return prepared.transactionId;
          },
          endorse: async () => {
            const endorsed = await prepared.endorse();
            return {
              get transactionId() {
                return endorsed.transactionId;
              },
              get result() {
                return endorsed.result;
              },
              get bytes() {
                return endorsed.bytes;
              },
              submit: async () => {
                if (mode.current === 'drop')
                  throw new Error('simulated network drop before broadcast');
                const outcome = await endorsed.submit();
                if (mode.current === 'lost')
                  throw new Error('simulated lost commit status');
                return outcome;
              },
            };
          },
        };
      }) as never;
      return () => {
        client.recordBindingEvent = original;
      };
    }
    const attemptsOf = async (eventId: string) =>
      prisma.deliveryAttempt.findMany({
        where: { outbox: { eventId } },
        include: { outcomes: { orderBy: { sequence: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      });

    it('reconciles a lost commit response from the ledger without sending the event twice', async () => {
      const w = worlds.b;
      await settle(unconfirmed(w));
      const mode = { current: 'lost' as 'pass' | 'lost' | 'drop' };
      const restore = await interceptSubmit(w, mode);
      try {
        const cycle = await cycleFlow(w);
        const event = await prisma.traceEvent.findFirstOrThrow({
          where: { cycleId: cycle.id, entityType: 'PRODUCTION_CYCLE' },
        });
        await delivery.processAll();
        let attempts = await attemptsOf(event.id);
        expect(attempts).toHaveLength(1);
        expect(attempts[0].outcomes.at(-1)?.state).toBe('UNKNOWN');
        // The transaction did commit; only the response was lost.
        const reader = (await pilotClient('org1', 'relayer', w.channel)).client;
        expect(
          (
            (await reader.getBindingProof(w.chainRef, event.id)) as {
              dataHash: string;
            }
          ).dataHash,
        ).toBe(event.dataHash);
        mode.current = 'pass';
        await expedite();
        await delivery.processAll();
        attempts = await attemptsOf(event.id);
        expect(attempts).toHaveLength(1); // no second submission
        expect(attempts[0].outcomes.at(-1)).toMatchObject({
          state: 'VALID',
          detail: 'reconciled from the ledger',
        });
        expect(
          (
            await prisma.blockchainProof.findUniqueOrThrow({
              where: { eventId: event.id },
            })
          ).transactionStatus,
        ).toBe('CONFIRMED');
        expect(
          await reader.getBindingHead(w.chainRef, 'PRODUCTION_CYCLE', cycle.id),
        ).toMatchObject({ eventCount: 1 });
      } finally {
        restore();
      }
    }, 240_000);

    it('fences an attempt that never reached the orderer, then delivers with the next generation', async () => {
      const w = worlds.b;
      await settle(unconfirmed(w));
      const mode = { current: 'drop' as 'pass' | 'lost' | 'drop' };
      const restore = await interceptSubmit(w, mode);
      try {
        const cycle = await cycleFlow(w);
        const event = await prisma.traceEvent.findFirstOrThrow({
          where: { cycleId: cycle.id, entityType: 'PRODUCTION_CYCLE' },
        });
        await delivery.processAll();
        expect((await attemptsOf(event.id))[0].outcomes.at(-1)?.state).toBe(
          'UNKNOWN',
        );
        mode.current = 'pass';
        await expedite();
        await delivery.processAll(); // unknown and absent: request a fence, never resend
        expect(
          await prisma.ledgerControlJob.count({
            where: { eventId: event.id, operation: 'FENCE_DELIVERY' },
          }),
        ).toBe(1);
        expect(await attemptsOf(event.id)).toHaveLength(1);
        await settle(
          async () =>
            (
              await prisma.blockchainProof.findUnique({
                where: { eventId: event.id },
              })
            )?.transactionStatus === 'CONFIRMED',
          20,
        );
        const attempts = await attemptsOf(event.id);
        expect(attempts).toHaveLength(2);
        expect(attempts[0].outcomes.at(-1)?.state).toBe('ABANDONED');
        expect(attempts[1]).toMatchObject({ generation: 1 });
        expect(attempts[1].outcomes.at(-1)?.state).toBe('VALID');
        const reader = (await pilotClient('org1', 'relayer', w.channel)).client;
        expect(
          await reader.getDeliveryFence(w.chainRef, event.id),
        ).toMatchObject({
          generation: '1',
        });
      } finally {
        restore();
      }
    }, 240_000);

    it('emergency revoke holds delivery at once, revokes without draining and marks the permission for review', async () => {
      const w = worlds.self;
      const grant = await prisma.scopedRoleGrant.findFirstOrThrow({
        where: {
          chainId: w.chainId,
          userId: w.users.retailer,
          role: 'RETAILER',
          revokedAt: null,
        },
      });
      const sync = () =>
        prisma.ledgerPermissionSync.findFirstOrThrow({
          where: {
            permission: {
              userId: w.users.retailer,
              binding: { digest: w.bindingDigest },
            },
          },
          include: { permission: true },
        });
      const { requestLedgerRevoke } =
        await import('../src/modules/ledger/ledger-permissions.js');
      await prisma.$transaction(async (tx) => {
        await tx.scopedRoleGrant.update({
          where: { id: grant.id },
          data: { revokedAt: new Date(), revision: { increment: 1 } },
        });
        await requestLedgerRevoke(
          tx,
          grant.id,
          'EMERGENCY',
          'key compromise suspected',
        );
      });
      const held = await sync();
      expect(held.state).toBe('EMERGENCY_HOLD');
      expect(
        await prisma.deliveryHold.count({
          where: { permissionRef: held.permissionRef, resolvedAt: null },
        }),
      ).toBe(1);
      await settle(
        async () => (await sync()).state === 'REVOKED_REVIEW_REQUIRED',
        20,
      );
      const reader = (await pilotClient('org1', 'relayer', w.channel)).client;
      expect(
        await reader.getRegistryPermission(held.permissionRef),
      ).toMatchObject({
        status: 'REVOKED',
        reviewRequired: true,
      });
      // The hold stays open until a reviewer resolves it; nothing opens the write meanwhile.
      expect(
        await prisma.deliveryHold.count({
          where: { permissionRef: held.permissionRef, resolvedAt: null },
        }),
      ).toBe(1);
    }, 240_000);
  },
);
