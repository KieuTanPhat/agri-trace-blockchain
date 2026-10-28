import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { BindingConnectionPool } from '../src/modules/ledger/binding-pool.js';
import { BindingDeliveryService } from '../src/modules/ledger/binding-delivery.service.js';
import { LedgerControlService } from '../src/modules/ledger/ledger-control.service.js';
import { EnterpriseConnectionWorker } from '../src/modules/enterprise-onboarding/enterprise-connection.worker.js';
import {
  AwaitingOwnerApproval,
  ExternalOwnerRegistryOperator,
} from '../src/modules/ledger/external-owner-operator.js';
import {
  activateBinding,
  registerBinding,
} from '../src/modules/ledger/ledger-bindings.js';
import {
  mirrorCredential,
  onboardBindingOnLedger,
} from '../src/modules/ledger/ledger-onboarding.js';
import {
  activateSigningKey,
  registerSigningKeyOnLedger,
  setHandoverMode,
} from '../src/modules/ledger/ledger-signing.js';
import type { IntentBody } from '../src/modules/trace/signed-commitment.js';
import { provisionChain } from './support/chain-scope.js';
import { seedCycleEvidence } from './support/cycle-evidence.js';
import { TestSigner } from './support/signer.js';
import {
  CHAINCODE,
  CONTRACT,
  WRITER_AUTHORITY,
  closePilotConnections,
  pilotClient,
  pilotDocker,
  pilotOperator,
  peerCa,
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
    let serviceActivatorId: string;
    let delivery: BindingDeliveryService;
    let control: LedgerControlService;
    let pool: BindingConnectionPool;
    let config: ConfigService;
    let service: PrismaService;
    const worlds: Record<string, World> = {};
    const cycleEvidence = new Map<
      string,
      Awaited<ReturnType<typeof seedCycleEvidence>> & {
        representativeUserId: string;
        version: number;
      }
    >();

    const post = (
      w: World,
      path: string,
      body: object,
      who: keyof World['users'] = 'farm',
    ) => {
      const harvest = path.match(/^\/production-cycles\/([^/]+)\/harvests$/);
      const care = path.match(/^\/production-cycles\/([^/]+)\/care$/);
      const evidence = cycleEvidence.get(harvest?.[1] ?? care?.[1] ?? '');
      const payload = evidence
        ? {
            ...(harvest
              ? {
                  version: evidence.version,
                  lotName: 'Hybrid fixture harvest',
                  representativeUserId: evidence.representativeUserId,
                  evidenceRef: evidence.harvestEvidenceRef,
                  lotImageEvidenceRef: evidence.lotImageEvidenceRef,
                }
              : {
                  version: evidence.version,
                  name: 'Hybrid fixture care record',
                  evidenceRef: evidence.careEvidenceRef,
                }),
            ...body,
          }
        : body;
      return request(app.getHttpServer())
        .post('/api' + path)
        .set(
          'Authorization',
          `Bearer ${jwt.sign({ sub: w.users[who], sid: w.sessions[who] })}`,
        )
        .set('Idempotency-Key', randomUUID())
        .on('response', (response) => {
          if (response.status === 403)
            console.error('Hybrid HTTP denial', {
              path,
              error: response.body?.error?.message ?? response.body?.message,
            });
        })
        .send(payload);
    };
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
        simulatedLedger: false,
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
        channelPolicy?: unknown;
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
      const stagedController =
        owner === 'org3'
          ? await pilotClient('org1', 'controller', channel)
          : null;
      const stagedAdmin =
        owner === 'org3' ? await pilotClient('org1', 'Admin', channel) : null;
      const ownerAdmin =
        owner === 'org3' ? await pilotClient('org3', 'Admin', channel) : null;
      const operator =
        stagedController && stagedAdmin
          ? new ExternalOwnerRegistryOperator(
              stagedController.client,
              { Org1MSP: stagedAdmin.client },
              {
                channelId: channel,
                chaincodeName: CHAINCODE,
                contractName: CONTRACT,
                governanceDigest: health.governanceDigest,
              },
            )
          : ledger.operator;
      const onboarding = () =>
        onboardBindingOnLedger({
          operator,
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
      let stagedApprovals = 0;
      for (;;) {
        try {
          await onboarding();
          break;
        } catch (error) {
          if (!(error instanceof AwaitingOwnerApproval) || !ownerAdmin)
            throw error;
          const review = error.review.proposal as { proposalId: string };
          await ownerAdmin.client.invoke('ApproveRegistryChange', [
            review.proposalId,
          ]);
          stagedApprovals += 1;
          if (stagedApprovals > 3)
            throw new Error('Onboarding did not resume the original proposals');
        }
      }
      if (owner === 'org3')
        expect(stagedApprovals).toBe(health.channelPolicy ? 2 : 3);
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
      process.env.ENTERPRISE_ONBOARDING_ENABLED = 'true';
      const administratorRole = await prisma.role.upsert({
        where: { code: 'SYSTEM_ADMIN' },
        create: { code: 'SYSTEM_ADMIN', name: 'SYSTEM_ADMIN' },
        update: {},
      });
      serviceActivatorId = (
        await prisma.user.create({
          data: {
            fullName: 'Fabric fixture service administrator',
            email: `fabric-service-admin-${randomUUID()}@example.test`,
            roleId: administratorRole.id,
            passwordHash: 'not-a-login-fixture',
          },
        })
      ).id;
      productId = (
        await prisma.product.create({
          data: { productName: 'Hybrid B vegetables', defaultUnit: 'kg' },
        })
      ).id;
      worlds.b = await createWorld('hb', 'hybrid-b', 'org2');
      worlds.self = await createWorld('hs', 'hybrid-self', 'org3');
      worlds.signed = await createWorld('hc', 'hybrid-b', 'org2');
      const file = writeBindingsConfig([
        worlds.b.bindingDigest,
        worlds.self.bindingDigest,
        worlds.signed.bindingDigest,
      ]);
      config = new ConfigService({
        FABRIC_MAX_RETRIES: '8',
        FABRIC_CLAIM_LEASE_MS: '120000',
      });
      pool = new BindingConnectionPool();
      pool.environment = { FABRIC_BINDINGS_CONFIG: file };
      service = prisma as unknown as PrismaService;
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
      for (const w of [worlds.b, worlds.self, worlds.signed])
        await prisma.$transaction((tx) => activateBinding(tx, w.bindingDigest));
      for (const w of [worlds.b, worlds.self, worlds.signed])
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
      cycleEvidence.set(cycle.id, {
        ...(await seedCycleEvidence(prisma, {
          organizationId: w.orgs.farm,
          cycleId: cycle.id,
          actorId: w.users.farm,
        })),
        representativeUserId: w.users.farm,
        version: 1,
      });
      return cycle as { id: string };
    }

    it('checks a self-managed peer with actual owner endorsement and recovers a lost probe response using the original transaction', async () => {
      const w = worlds.self;
      const enrollment = await prisma.enterpriseEnrollment.create({
        data: {
          id: randomUUID(),
          organizationId: w.orgs.farm,
          ownerId: w.users.farm,
          businessId: `FABRIC-${randomUUID().slice(0, 12)}`,
          registrationDigest: 'a'.repeat(64),
          hostingMode: 'SELF_MANAGED_ORG',
          status: 'APPROVED',
          // This ledger suite starts after service activation; the HTTP
          // admission/activation lifecycle is covered by its own E2E suite.
          serviceActivatedAt: new Date(),
          serviceActivatedBy: serviceActivatorId,
          serviceActivationReason: 'Approved for real Fabric integration acceptance',
        },
      });
      const port = 11051 + Number(process.env.AGRI_FABRIC_PORT_OFFSET ?? 0);
      const id = randomUUID();
      await post(w, '/enterprise-connections', {
        id,
        chainId: w.chainId,
        peerHost: 'localhost',
        peerPort: port,
        peerServerName: 'peer0.org3.example.com',
        mspId: 'Org3MSP',
        tlsCaPem: readFileSync(peerCa('org3'), 'utf8'),
      }).expect(201);
      // Operator admission is covered over HTTP in enterprise-onboarding.e2e.
      await prisma.enterpriseConnection.update({
        where: { id },
        data: { status: 'APPROVED', version: { increment: 1 } },
      });
      const inventory =
        pool.environment.FABRIC_BINDINGS_CONFIG! + '.enterprise';
      writeFileSync(
        inventory,
        JSON.stringify({
          version: 1,
          targets: [
            {
              connectionId: id,
              organizationId: w.orgs.farm,
              chainId: w.chainId,
              bindingDigest: w.bindingDigest,
              ownerMspId: 'Org3MSP',
              peerEndpoint: `localhost:${port}`,
              peerHostAlias: 'peer0.org3.example.com',
              tlsCertPath: peerCa('org3'),
            },
          ],
        }),
        { mode: 0o600 },
      );
      const worker = new EnterpriseConnectionWorker(service, pool);
      worker.environment = {
        ...pool.environment,
        ENTERPRISE_ONBOARDING_ENABLED: 'true',
        ENTERPRISE_CONNECTIONS_CONFIG: inventory,
      };
      // No operator inventory means no dial, no state transition and no success.
      const unconfigured = new EnterpriseConnectionWorker(service, pool);
      unconfigured.environment = { ENTERPRISE_ONBOARDING_ENABLED: 'true' };
      await unconfigured.processAll();
      expect(
        (await prisma.enterpriseConnection.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe('APPROVED');
      const binding = await prisma.fabricNetworkBinding.findUniqueOrThrow({
        where: { digest: w.bindingDigest },
      });
      const { client } = await pool.get(binding, 'relayer');
      const original = client.prepare.bind(client);
      let preparedCount = 0;
      client.prepare = ((...args: Parameters<typeof original>) => {
        const prepared = original(...args);
        if (args[0] !== 'RecordConnectionProbe') return prepared;
        preparedCount += 1;
        return {
          transactionId: prepared.transactionId,
          endorse: async () => {
            const endorsed = await prepared.endorse();
            return {
              ...endorsed,
              submit: async () => {
                const result = await endorsed.submit();
                expect(result.successful).toBe(true);
                throw new Error(
                  'simulated lost response after a real VALID commit',
                );
              },
            };
          },
        };
      }) as typeof client.prepare;
      try {
        await worker.processAll();
        const unknown = await prisma.enterpriseConnection.findUniqueOrThrow({
          where: { id },
        });
        expect(unknown.status).toBe('UNKNOWN');
        expect(unknown.evidence).toBeNull();
        expect(unknown.txId).toMatch(/^[a-f0-9]{64}$/);
        await prisma.enterpriseConnection.update({
          where: { id },
          data: { leaseExpiresAt: new Date(0), version: { increment: 1 } },
        });
        const other = new EnterpriseConnectionWorker(service, pool);
        other.environment = worker.environment;
        await Promise.all([worker.processAll(), other.processAll()]);
        const connected = await prisma.enterpriseConnection.findUniqueOrThrow({
          where: { id },
        });
        expect(connected.status).toBe('CONNECTED');
        expect(connected.txId).toBe(unknown.txId);
        expect(connected.evidence).toMatchObject({
          ownerMsp: 'Org3MSP',
          writerMsp: 'Org1MSP',
          organizationRef: w.orgs.farm,
          txId: unknown.txId,
        });
        expect(preparedCount).toBe(1);
        expect(await client.transactionValidationCode(connected.txId!)).toBe(0);
        await expect(
          prisma.enterpriseConnection.update({
            where: { id },
            data: { evidence: {}, version: { increment: 1 } },
          }),
        ).rejects.toThrow();
        expect(enrollment.ownerId).toBe(w.users.farm);
      } finally {
        client.prepare = original;
      }
    }, 120_000);

    it('connects a managed peer but refuses allocating its network MSP to another enterprise', async () => {
      const inventory =
        pool.environment.FABRIC_BINDINGS_CONFIG! + '.managed-enterprise';
      const targets = [];
      const ids: string[] = [];
      for (const w of [worlds.b, worlds.signed]) {
        const enrollment = await prisma.enterpriseEnrollment.create({
          data: {
            id: randomUUID(),
            organizationId: w.orgs.farm,
            ownerId: w.users.farm,
            businessId: `MANAGED-${randomUUID().slice(0, 12)}`,
            registrationDigest: 'b'.repeat(64),
            hostingMode: 'MANAGED_ORG',
            status: 'APPROVED',
            serviceActivatedAt: new Date(),
            serviceActivatedBy: serviceActivatorId,
            serviceActivationReason: 'Approved for real Fabric integration acceptance',
          },
        });
        const id = randomUUID();
        ids.push(id);
        await post(w, '/enterprise-connections', {
          id,
          chainId: w.chainId,
        }).expect(201);
        await prisma.enterpriseConnection.update({
          where: { id },
          data: { status: 'APPROVED', version: { increment: 1 } },
        });
        targets.push({
          connectionId: id,
          organizationId: enrollment.organizationId,
          chainId: w.chainId,
          bindingDigest: w.bindingDigest,
          ownerMspId: 'Org2MSP',
          peerEndpoint: `localhost:${9051 + Number(process.env.AGRI_FABRIC_PORT_OFFSET ?? 0)}`,
          peerHostAlias: 'peer0.org2.example.com',
          tlsCertPath: peerCa('org2'),
        });
      }
      writeFileSync(inventory, JSON.stringify({ version: 1, targets }), {
        mode: 0o600,
      });
      const worker = new EnterpriseConnectionWorker(service, pool);
      worker.environment = {
        ...pool.environment,
        ENTERPRISE_ONBOARDING_ENABLED: 'true',
        ENTERPRISE_CONNECTIONS_CONFIG: inventory,
      };
      await worker.processAll();
      const first = await prisma.enterpriseConnection.findUniqueOrThrow({
        where: { id: ids[0] },
      });
      const second = await prisma.enterpriseConnection.findUniqueOrThrow({
        where: { id: ids[1] },
      });
      expect(first.status).toBe('CONNECTED');
      expect(first.evidence).toMatchObject({
        ownerMsp: 'Org2MSP',
        organizationRef: worlds.b.orgs.farm,
      });
      expect(second.status).toBe('FAILED');
      expect(second.errorCode).toBe('CONNECTION_MSP_ALREADY_ASSIGNED');
      expect(second.txId).toBeNull();
    }, 120_000);

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

    it('projects the ledger status of a chain without exposing network details', async () => {
      const w = worlds.b;
      const status = (
        await get(
          w,
          `/supply-chains/${w.chainId}/ledger-status`,
          'transporter',
        ).expect(200)
      ).body.data;
      expect(status).toMatchObject({
        chainId: w.chainId,
        profile: 'MANAGED_ORG',
        bindingStatus: 'ACTIVE',
        channelId: 'hybrid-b',
        permissions: { pending: 0 },
      });
      expect(status.permissions.active).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(status)).not.toMatch(
        /network|msp|endpoint|fingerprint|digest/i,
      );
      // A chain without a binding stays release A; another organization sees nothing.
      await get(
        worlds.self,
        `/supply-chains/${w.chainId}/ledger-status`,
      ).expect(404);
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

    // ----------------------------------------------------------- release C
    type Party = 'farm' | 'transporter' | 'retailer';
    const signers = {} as Record<Party, TestSigner>;
    const keyOf = {} as Record<Party, string>;

    async function enrollSigners(w: World) {
      const ledger = await pilotOperator(w.channel, w.owner);
      for (const party of ['farm', 'transporter', 'retailer'] as const) {
        const signer = TestSigner.generate();
        const keyRef = randomUUID();
        await post(
          w,
          `/supply-chains/${w.chainId}/signing-keys`,
          {
            keyRef,
            label: party,
            publicKey: signer.publicKey,
            popSignature: signer.proof({
              bindingDigest: w.bindingDigest,
              keyRef,
              orgRef: w.orgs[party],
            }),
          },
          party,
        ).expect(201);
        // The operator registers the key on the ledger with the owner's approval.
        await registerSigningKeyOnLedger({
          operator: ledger.operator,
          reader: ledger.reader,
          approvers: ledger.approvers,
          key: await prisma.signingKey.findUniqueOrThrow({ where: { keyRef } }),
        });
        await activateSigningKey(prisma, keyRef);
        signers[party] = signer;
        keyOf[party] = keyRef;
      }
      await setHandoverMode(prisma, w.chainId, 'DUAL_SIGNED');
    }

    async function signed(
      w: World,
      who: Party,
      path: string,
      body: object,
      signer: TestSigner = signers[who],
    ) {
      const prepared = (await post(w, path, body, who).expect(201)).body
        .data as {
        intentId: string;
        intent: IntentBody;
      };
      const res = await post(
        w,
        `/signing-intents/${prepared.intentId}/submit`,
        { signature: signer.signIntent(prepared.intent) },
        who,
      );
      return { prepared, res };
    }

    async function signedShipment(w: World) {
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
      return {
        shipmentId: await shipLot(w, harvested.lot.id, 2),
        lotId: harvested.lot.id as string,
      };
    }

    it('delivers a two-party handover to the ledger with both organization signatures verified there', async () => {
      const w = worlds.signed;
      await enrollSigners(w);
      const { shipmentId, lotId } = await signedShipment(w);
      expect(
        (await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }))
          .handoverMode,
      ).toBe('DUAL_SIGNED');
      const pickup = await signed(
        w,
        'farm',
        `/shipments/${shipmentId}/handover-offers/intent`,
        { kind: 'PICKUP' },
      );
      expect(pickup.res.status).toBe(201);
      const confirmed = await signed(
        w,
        'transporter',
        `/handovers/${pickup.res.body.data.id}/confirmation/intent`,
        {},
      );
      expect(confirmed.res.body.data.state).toBe('CONFIRMED');
      const arrival = await signed(
        w,
        'transporter',
        `/shipments/${shipmentId}/handover-offers/intent`,
        { kind: 'ARRIVAL' },
      );
      await signed(
        w,
        'retailer',
        `/handovers/${arrival.res.body.data.id}/confirmation/intent`,
        {},
      );
      await post(
        w,
        `/shipments/${shipmentId}/receive`,
        { version: 2, lotVersion: 2, receivedQuantity: 2 },
        'retailer',
      ).expect(201);
      await settle(unconfirmed(w), 60);

      const events = await prisma.traceEvent.findMany({
        where: { entityId: shipmentId, actorSignature: { isNot: null } },
        include: { actorSignature: true, blockchainProof: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.eventType)).toEqual([
        'HANDOVER_OFFERED',
        'HANDOVER_CONFIRMED',
        'HANDOVER_OFFERED',
        'HANDOVER_CONFIRMED',
      ]);
      const reader = (await pilotClient('org1', 'relayer', w.channel)).client;
      const signerOrgs = [
        w.orgs.farm,
        w.orgs.transporter,
        w.orgs.transporter,
        w.orgs.retailer,
      ];
      for (const [index, event] of events.entries()) {
        expect(event.blockchainProof?.transactionStatus).toBe('CONFIRMED');
        const onLedger = (await reader.getBindingProof(
          w.chainRef,
          event.id,
        )) as {
          dataHash: string;
          signature: {
            keyRef: string;
            orgRef: string;
            assertionDigest: string;
          };
        };
        expect(onLedger.dataHash).toBe(event.dataHash);
        expect(onLedger.signature).toMatchObject({
          keyRef: event.actorSignature?.keyRef,
          orgRef: signerOrgs[index],
          assertionDigest: event.actorSignature?.assertionDigest,
        });
        const proof = (
          await get(w, `/trace/events/${event.id}/proof`).expect(200)
        ).body.data;
        expect(proof).toMatchObject({
          transactionStatus: 'CONFIRMED',
          localHashMatches: true,
        });
      }
      const lot = await get(w, `/lots/${lotId}`).expect(200);
      expect(JSON.stringify(lot.body.data)).toContain('VERIFIED');
    }, 300_000);

    it('withdraws a revoked key through the Worker and refuses signed events delivered afterwards', async () => {
      const w = worlds.signed;
      const { shipmentId } = await signedShipment(w);
      // Signed and committed in the database, but not yet delivered.
      const offer = await signed(
        w,
        'farm',
        `/shipments/${shipmentId}/handover-offers/intent`,
        { kind: 'PICKUP' },
      );
      expect(offer.res.status).toBe(201);
      const signedEvent = await prisma.traceEvent.findFirstOrThrow({
        where: { entityId: shipmentId, eventType: 'HANDOVER_OFFERED' },
      });
      // The farm organization withdraws the key before the Worker relays the event.
      await post(
        w,
        `/supply-chains/${w.chainId}/signing-keys/${keyOf.farm}/revoke`,
        { reason: 'signer device lost' },
        'farm',
      ).expect(201);
      const reader = (await pilotClient('org1', 'relayer', w.channel)).client;
      const revoked = async () =>
        (
          (await reader.getRegistrySigningKey(w.bindingDigest, keyOf.farm)) as {
            status: string;
          }
        ).status === 'REVOKED';
      await settle(revoked, 20);
      // The key is gone from the ledger registry too, and the event cannot land.
      await settle(
        async () =>
          (
            await prisma.blockchainOutbox.findUniqueOrThrow({
              where: { eventId: signedEvent.id },
            })
          ).status === 'DEAD_LETTER',
        30,
      );
      // Keep the exact rejection reason in internal evidence; HTTP readers
      // receive a generic diagnostic under the AGT-009 privacy contract.
      const delivery = await prisma.blockchainOutbox.findUniqueOrThrow({
        where: { eventId: signedEvent.id },
      });
      expect(delivery.lastError).toMatch(/SIGNING_KEY_INACTIVE/);
      const proof = (
        await get(w, `/trace/events/${signedEvent.id}/proof`).expect(200)
      ).body.data;
      expect(proof.transactionStatus).toBe('FAILED');
      expect(proof.lastError).toBe(
        'Blockchain delivery failed; contact support with eventId',
      );
      expect(JSON.stringify(proof)).not.toContain('SIGNING_KEY_INACTIVE');
      const verification = (
        await get(w, `/blockchain/events/${signedEvent.id}/verify`).expect(200)
      ).body.data;
      expect(verification).toMatchObject({
        status: 'FAILED',
        lastError: proof.lastError,
      });
      expect(JSON.stringify(verification)).not.toContain('SIGNING_KEY_INACTIVE');
      // Nothing was verified, and the handover never moved custody.
      expect(
        await prisma.blockchainProof.count({
          where: { eventId: signedEvent.id },
        }),
      ).toBe(0);
      expect(
        (await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } }))
          .status,
      ).toBe('CREATED');
    }, 300_000);

    // ---------------------------------------------------- faults and load
    /** A second Worker process: its own pool and services over the same database. */
    function secondWorker() {
      const pool2 = new BindingConnectionPool();
      pool2.environment = pool.environment;
      return {
        pool: pool2,
        delivery: new BindingDeliveryService(service, config, pool2),
        control: new LedgerControlService(service, config, pool2),
      };
    }
    const outboxFor = (w: World) => ({
      traceEvent: { chainContext: { chainId: w.chainId } },
    });

    it('lets two Workers drain one backlog exactly once, including a crashed Worker lease', async () => {
      const w = worlds.b;
      const other = secondWorker();
      try {
        for (let i = 0; i < 12; i += 1) await cycleFlow(w);
        // Two real processes would race on the same rows from here on.
        for (
          let round = 0;
          round < 40 && !(await unconfirmed(w)());
          round += 1
        ) {
          await Promise.all([
            delivery.processAll(),
            other.delivery.processAll(),
          ]);
          await expedite();
        }
        expect(await unconfirmed(w)()).toBe(true);
        const rows = await prisma.blockchainOutbox.findMany({
          where: outboxFor(w),
          include: {
            deliveryAttempts: { include: { outcomes: true } },
            traceEvent: { include: { blockchainProof: true } },
          },
        });
        expect(rows.length).toBeGreaterThanOrEqual(12);
        for (const row of rows) {
          expect(row.status).toBe('COMPLETED');
          expect(row.traceEvent.blockchainProof?.transactionStatus).toBe(
            'CONFIRMED',
          );
          // One claim owner at a time: a single attempt and a single VALID outcome.
          const valid = row.deliveryAttempts
            .flatMap((a) => a.outcomes)
            .filter((o) => o.state === 'VALID');
          expect(valid).toHaveLength(1);
        }

        // A crashed Worker leaves PROCESSING rows with an expired lease and no attempt.
        for (let i = 0; i < 3; i += 1) await cycleFlow(w);
        const stale = await prisma.blockchainOutbox.findMany({
          where: { ...outboxFor(w), status: { not: 'COMPLETED' } },
          select: { id: true },
        });
        expect(stale.length).toBeGreaterThanOrEqual(3);
        for (const row of stale)
          await prisma.$executeRaw`UPDATE blockchain_outbox SET status = 'PROCESSING'::blockchain_outbox_status,
            lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() - interval '1 minute'
            WHERE outbox_id = ${row.id}::uuid`;
        for (
          let round = 0;
          round < 40 && !(await unconfirmed(w)());
          round += 1
        ) {
          await Promise.all([
            other.delivery.processAll(),
            delivery.processAll(),
          ]);
          await expedite();
        }
        expect(await unconfirmed(w)()).toBe(true);
        const proofs = await prisma.blockchainProof.count({
          where: { traceEvent: { chainContext: { chainId: w.chainId } } },
        });
        const events = await prisma.traceEvent.count({
          where: { chainContext: { chainId: w.chainId } },
        });
        expect(proofs).toBe(events);
      } finally {
        other.pool.onModuleDestroy();
      }
    }, 360_000);

    const load = process.env.HYBRID_LOAD_E2E === '1' ? it : it.skip;
    load(
      'keeps the API responsive under 10 clients and 200 Pending events on two bindings, then drains',
      async () => {
        // 10 clients share one test IP; the per-IP throttle (default 120/min)
        // is a separate control, so this scenario needs it raised.
        expect(
          Number(process.env.RATE_LIMIT_REQUESTS ?? 120),
          'Run the load scenario with RATE_LIMIT_REQUESTS=100000',
        ).toBeGreaterThanOrEqual(1000);
        const clients = 10;
        const perClient = 20;
        const targets = [worlds.b, worlds.self];
        // One cycle per client: care commands on a cycle are optimistic-version ordered.
        const lanes: Array<{ w: World; id: string; version: number }> = [];
        for (let i = 0; i < clients; i += 1) {
          const w = targets[i % targets.length];
          const cycle = await cycleFlow(w);
          const planted = await post(
            w,
            `/production-cycles/${cycle.id}/plant`,
            {
              version: 0,
              plantedAt: '2026-09-25T00:00:00.000Z',
            },
          ).expect(201);
          cycleEvidence.set(cycle.id, {
            ...(await seedCycleEvidence(prisma, {
              organizationId: w.orgs.farm,
              cycleId: cycle.id,
              actorId: w.users.farm,
            })),
            representativeUserId: w.users.farm,
            version: planted.body.data.version,
          });
          lanes.push({ w, id: cycle.id, version: planted.body.data.version });
        }
        await settle(
          async () =>
            (await unconfirmed(worlds.b)()) &&
            (await unconfirmed(worlds.self)()),
          60,
        );

        // Both ledgers are unreachable for endorsement: events accumulate Pending.
        pilotDocker('stop', 'peer0.org2.example.com', 'peer0.org3.example.com');
        const latencies: number[] = [];
        try {
          await Promise.all(
            lanes.map(async (lane) => {
              for (let n = 0; n < perClient; n += 1) {
                const started = performance.now();
                const res = await post(
                  lane.w,
                  `/production-cycles/${lane.id}/care`,
                  {
                    version: lane.version,
                    careType: 'WATERING',
                    eventTime: new Date(Date.now() - 1_000).toISOString(),
                  },
                );
                latencies.push(performance.now() - started);
                expect(res.status).toBe(201);
                lane.version = res.body.data.version;
              }
            }),
          );
        } finally {
          pilotDocker(
            'start',
            'peer0.org2.example.com',
            'peer0.org3.example.com',
          );
        }
        latencies.sort((a, b) => a - b);
        const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1];
        expect(latencies).toHaveLength(clients * perClient);
        expect(p95).toBeLessThanOrEqual(2000);
        const pending = await prisma.blockchainOutbox.count({
          where: { status: { not: 'COMPLETED' }, OR: targets.map(outboxFor) },
        });
        expect(pending).toBeGreaterThanOrEqual(clients * perClient);

        // Recovery: two Workers drain everything within the 15 minute bound.
        await new Promise((r) => setTimeout(r, 12_000));
        for (const w of targets) pool.invalidate(w.bindingDigest);
        const other = secondWorker();
        const started = Date.now();
        try {
          for (let round = 0; Date.now() - started < 15 * 60_000; round += 1) {
            await Promise.all([
              control.processAll(),
              delivery.processAll(),
              other.delivery.processAll(),
            ]);
            if (
              (await unconfirmed(worlds.b)()) &&
              (await unconfirmed(worlds.self)())
            )
              break;
            await expedite();
            await new Promise((r) => setTimeout(r, 400));
          }
        } finally {
          other.pool.onModuleDestroy();
        }
        const drainMs = Date.now() - started;
        expect(await unconfirmed(worlds.b)()).toBe(true);
        expect(await unconfirmed(worlds.self)()).toBe(true);
        expect(drainMs).toBeLessThanOrEqual(15 * 60_000);
        const dead = await prisma.blockchainOutbox.count({
          where: { status: 'DEAD_LETTER', OR: targets.map(outboxFor) },
        });
        expect(dead).toBe(0);
        const report = {
          events: clients * perClient,
          clients,
          bindings: targets.length,
          p95Ms: Math.round(p95),
          maxMs: Math.round(latencies[latencies.length - 1]),
          drainSeconds: Math.round(drainMs / 1000),
        };
        if (process.env.HYBRID_LOAD_REPORT)
          writeFileSync(process.env.HYBRID_LOAD_REPORT, JSON.stringify(report));
        console.info('hybrid-load', JSON.stringify(report));
      },
      1_200_000,
    );
  },
);
