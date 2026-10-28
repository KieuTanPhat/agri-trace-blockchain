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
import {
  activateBinding,
  recordCredential,
  registerBinding,
} from '../src/modules/ledger/ledger-bindings.js';
import {
  activateSigningKey,
  setHandoverMode,
} from '../src/modules/ledger/ledger-signing.js';
import type { IntentBody } from '../src/modules/trace/signed-commitment.js';
import { signedMessageForIntent } from '../src/modules/trace/signed-commitment.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import { provisionChain } from './support/chain-scope.js';
import { seedCycleEvidence } from './support/cycle-evidence.js';
import {
  generateSignerKey,
  registrationBody,
  signPreparedIntent,
} from '../src/modules/signing/org-signer.js';
import { TestSigner } from './support/signer.js';
import { requestLedgerGrant } from '../src/modules/ledger/ledger-permissions.js';

const connectionString = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      connectionString ?? 'postgresql://unused@localhost/unused',
  }),
});
const sql = (text: string) => prisma.$executeRawUnsafe(text);

type Party = 'farm' | 'transporter' | 'retailer';
const PARTIES: Party[] = ['farm', 'transporter', 'retailer'];

(connectionString ? describe : describe.skip)(
  'Release C two-party handover (API + database, no Fabric)',
  () => {
    let app: INestApplication;
    let jwt: JwtService;
    let productId: string;
    let chainId: string;
    let digest: string;
    let farmId: string;
    const orgs = {} as Record<Party, string>;
    const users = {} as Record<Party | 'staff', string>;
    const sessions = {} as Record<Party | 'staff', string>;
    const signers = {} as Record<Party, TestSigner>;
    const keyRefs = {} as Record<Party, string>;

    const call = (
      method: 'get' | 'post',
      path: string,
      who: Party | 'staff',
      body?: object,
    ) => {
      const r = request(app.getHttpServer())
        [method]('/api' + path)
        .set(
          'Authorization',
          `Bearer ${jwt.sign({ sub: users[who], sid: sessions[who] })}`,
        );
      return method === 'post'
        ? r.set('Idempotency-Key', randomUUID()).send(body ?? {})
        : r;
    };
    const post = (who: Party | 'staff', path: string, body?: object) =>
      call('post', path, who, body);
    const get = (who: Party | 'staff', path: string) => call('get', path, who);

    async function confirmPermissions() {
      const syncs = await prisma.ledgerPermissionSync.findMany({
        where: { permission: { bindingDigest: digest }, state: 'REQUESTED' },
      });
      for (const sync of syncs) {
        await sql(
          `UPDATE ledger_permission_sync SET state='PENDING_LEDGER', version=version+1 WHERE permission_ref='${sync.permissionRef}'`,
        );
        await sql(
          `UPDATE ledger_permission_sync SET state='ACTIVE', confirmed_epoch=requested_epoch, version=version+1 WHERE permission_ref='${sync.permissionRef}'`,
        );
      }
    }

    async function enroll(party: Party, signer = TestSigner.generate()) {
      const keyRef = randomUUID();
      const res = await post(party, `/supply-chains/${chainId}/signing-keys`, {
        keyRef,
        label: `${party} key`,
        publicKey: signer.publicKey,
        popSignature: signer.proof({
          bindingDigest: digest,
          keyRef,
          orgRef: orgs[party],
        }),
      });
      return { res, keyRef, signer };
    }

    beforeAll(async () => {
      productId = (
        await prisma.product.create({
          data: { productName: 'Handover vegetables', defaultUnit: 'kg' },
        })
      ).id;
      const roleFor = (code: string) =>
        prisma.role.upsert({
          where: { code },
          create: { code, name: code },
          update: {},
        });
      const make = (type: 'FARM' | 'TRANSPORTER' | 'RETAILER') =>
        prisma.organization.create({
          data: { name: `HO ${type} ${randomUUID()}`, type },
        });
      orgs.farm = (await make('FARM')).id;
      orgs.transporter = (await make('TRANSPORTER')).id;
      orgs.retailer = (await make('RETAILER')).id;
      const codes: Record<Party | 'staff', [string, string]> = {
        farm: ['FARM_STAFF', orgs.farm],
        staff: ['FARM_STAFF', orgs.farm],
        transporter: ['TRANSPORTER', orgs.transporter],
        retailer: ['RETAILER', orgs.retailer],
      };
      for (const [key, [code, organizationId]] of Object.entries(codes)) {
        const role = await roleFor(code);
        const user = await prisma.user.create({
          data: {
            fullName: `HO ${key}`,
            email: `ho-${key}-${randomUUID()}@example.test`,
            roleId: role.id,
            organizationId,
            passwordHash: 'not-a-login-fixture',
          },
        });
        users[key as Party | 'staff'] = user.id;
        sessions[key as Party | 'staff'] = randomUUID();
        await prisma.refreshSession.create({
          data: {
            id: sessions[key as Party | 'staff'],
            familyId: sessions[key as Party | 'staff'],
            userId: user.id,
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
          },
        });
      }
      farmId = (
        await prisma.farm.create({
          data: { organizationId: orgs.farm, name: 'HO farm' },
        })
      ).id;
      chainId = await provisionChain(prisma, {
        simulatedLedger: false,
        name: 'HO chain',
        ownerOrganizationId: orgs.farm,
        memberOrganizationIds: [orgs.transporter, orgs.retailer],
        grants: [
          { userId: users.farm, organizationId: orgs.farm, role: 'ORG_ADMIN' },
          {
            userId: users.farm,
            organizationId: orgs.farm,
            role: 'CHAIN_MANAGER',
          },
          { userId: users.farm, organizationId: orgs.farm, role: 'FARM_STAFF' },
          {
            userId: users.staff,
            organizationId: orgs.farm,
            role: 'FARM_STAFF',
          },
          {
            userId: users.transporter,
            organizationId: orgs.transporter,
            role: 'ORG_ADMIN',
          },
          {
            userId: users.transporter,
            organizationId: orgs.transporter,
            role: 'TRANSPORTER',
          },
          {
            userId: users.retailer,
            organizationId: orgs.retailer,
            role: 'ORG_ADMIN',
          },
          {
            userId: users.retailer,
            organizationId: orgs.retailer,
            role: 'RETAILER',
          },
        ],
      });
      const registered = await prisma.$transaction((tx) =>
        registerBinding(tx, {
          chainId,
          network: 'handover-fixture',
          channelId: 'hybrid-b',
          chaincodeName: 'agritrace',
          contractName: 'AgriTraceContract',
          writerAuthority: 'agritrace-relayer-b',
          writerMspId: 'Org1MSP',
          governanceDigest: '11'.repeat(32),
          profile: 'SERVICE',
        }),
      );
      digest = registered.digest;
      await prisma.$transaction((tx) =>
        recordCredential(tx, digest, 'ab'.repeat(32)),
      );
      await prisma.$transaction((tx) => activateBinding(tx, digest));
      await confirmPermissions();

      const fixture = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(ConfigService)
        .useValue({
          getOrThrow: () => 'hybrid-handover-e2e-secret',
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
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await prisma.$disconnect();
    });

    /** Cycle -> harvest -> consented plan -> finalized shipment. */
    async function newShipment(quantity = 2, sameOrganization = false) {
      const cycle = (
        await post('farm', '/production-cycles', {
          chainId,
          farmId,
          productId,
          cycleCode: `HO-${randomUUID()}`,
          maxHarvestQuantity: quantity,
          harvestUnit: 'kg',
        }).expect(201)
      ).body.data;
      await post('farm', `/production-cycles/${cycle.id}/plant`, {
        version: 0,
        plantedAt: '2026-09-25T00:00:00.000Z',
      }).expect(201);
      const evidence = await seedCycleEvidence(prisma, {
        organizationId: orgs.farm,
        cycleId: cycle.id,
        actorId: users.farm,
      });
      const harvested = (
        await post('farm', `/production-cycles/${cycle.id}/harvests`, {
          version: 1,
          lotName: 'Handover fixture harvest',
          representativeUserId: users.farm,
          evidenceRef: evidence.harvestEvidenceRef,
          lotImageEvidenceRef: evidence.lotImageEvidenceRef,
          quantity,
          unit: 'kg',
          harvestTime: '2026-09-26T00:00:00.000Z',
        }).expect(201)
      ).body.data;
      const base = `/supply-chains/${chainId}/shipment-plans`;
      const plan = (
        await post('farm', base, {
          lotId: harvested.lot.id,
          transporterOrgId: sameOrganization ? orgs.farm : orgs.transporter,
          retailerOrgId: sameOrganization ? orgs.farm : orgs.retailer,
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
        await post(sameOrganization ? 'farm' : who, `${base}/${plan.id}/accept`, {
          party,
          revision: plan.currentRevision,
          payloadDigest: plan.current.payloadDigest,
        }).expect(201);
      const done = (
        await post('farm', `${base}/${plan.id}/finalize`, {
          version: plan.version,
        }).expect(201)
      ).body.data;
      return {
        shipmentId: done.shipmentId as string,
        lotId: harvested.lot.id as string,
      };
    }

    const shipmentRow = (id: string) =>
      prisma.shipment.findUniqueOrThrow({ where: { id } });
    const lotRow = (id: string) =>
      prisma.lot.findUniqueOrThrow({ where: { id } });

    /** Prepare an intent, sign it as the named party and submit it. */
    const prepare = (who: Party, path: string, body: object = {}) =>
      post(who, path, body);
    async function signAndSubmit(
      who: Party,
      intent: { intentId: string; intent: IntentBody },
      signer: TestSigner = signers[who],
    ) {
      return post(who, `/signing-intents/${intent.intentId}/submit`, {
        signature: signer.signIntent(intent.intent),
      });
    }
    async function offer(
      who: Party,
      shipmentId: string,
      kind: 'PICKUP' | 'ARRIVAL',
    ) {
      const raw = await prepare(
        who,
        `/shipments/${shipmentId}/handover-offers/intent`,
        { kind },
      );
      expect(raw.status, JSON.stringify(raw.body)).toBe(201);
      const prepared = raw.body.data;
      const res = await signAndSubmit(who, prepared);
      return { prepared, res };
    }
    async function confirm(who: Party, handoverId: string) {
      const prepared = (
        await prepare(
          who,
          `/handovers/${handoverId}/confirmation/intent`,
        ).expect(201)
      ).body.data;
      const res = await signAndSubmit(who, prepared);
      return { prepared, res };
    }
    const noEvents = (shipmentId: string, type: string) =>
      prisma.traceEvent.count({
        where: { entityId: shipmentId, eventType: type },
      });

    // ---------------------------------------------------------------- keys
    it('enrolls a key with proof of possession and keeps it unusable until the ledger activates it', async () => {
      // Only an ORG_ADMIN may enroll keys for its organization.
      const staffKey = TestSigner.generate();
      const staffRef = randomUUID();
      await post('staff', `/supply-chains/${chainId}/signing-keys`, {
        keyRef: staffRef,
        label: 'staff',
        publicKey: staffKey.publicKey,
        popSignature: staffKey.proof({
          bindingDigest: digest,
          keyRef: staffRef,
          orgRef: orgs.farm,
        }),
      }).expect(403);

      // A copied public key without the private key fails the proof of possession.
      const thief = TestSigner.generate();
      const stolen = TestSigner.generate();
      const stolenRef = randomUUID();
      const forged = await post(
        'farm',
        `/supply-chains/${chainId}/signing-keys`,
        {
          keyRef: stolenRef,
          label: 'forged',
          publicKey: stolen.publicKey,
          popSignature: thief.proof({
            bindingDigest: digest,
            keyRef: stolenRef,
            orgRef: orgs.farm,
          }),
        },
      );
      expect(forged.status).toBe(422);
      // A proof made for another organization cannot be replayed for this one.
      const replayRef = randomUUID();
      const replayKey = TestSigner.generate();
      const replay = await post(
        'farm',
        `/supply-chains/${chainId}/signing-keys`,
        {
          keyRef: replayRef,
          label: 'replay',
          publicKey: replayKey.publicKey,
          popSignature: replayKey.proof({
            bindingDigest: digest,
            keyRef: replayRef,
            orgRef: orgs.retailer,
          }),
        },
      );
      expect(replay.status).toBe(422);

      for (const party of PARTIES) {
        const { res, keyRef, signer } = await enroll(party);
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
          status: 'PENDING_LEDGER',
          organizationId: orgs[party],
        });
        keyRefs[party] = keyRef;
        signers[party] = signer;
      }
      // The same public key cannot be enrolled twice.
      const dup = await enroll('farm', signers.farm);
      expect(dup.res.status).toBe(409);

      const context = (
        await get('farm', `/supply-chains/${chainId}/signing-keys`).expect(200)
      ).body.data;
      expect(context).toMatchObject({
        bindingDigest: digest,
        handoverMode: 'STANDARD',
      });
      expect(context.keys).toHaveLength(1);
      // Another organization sees only its own keys.
      const other = (
        await get('retailer', `/supply-chains/${chainId}/signing-keys`).expect(
          200,
        )
      ).body.data;
      expect(other.keys.map((k: { keyRef: string }) => k.keyRef)).toEqual([
        keyRefs.retailer,
      ]);

      // Before activation the protocol refuses to switch on, even for an operator.
      await expect(
        setHandoverMode(prisma, chainId, 'DUAL_SIGNED'),
      ).rejects.toThrow(/ACTIVE signing key/);
    });

    it('does not let a standard shipment be handed over, and keeps its A/B endpoints', async () => {
      const { shipmentId } = await newShipment();
      expect((await shipmentRow(shipmentId)).handoverMode).toBe('STANDARD');
      await activateSigningKey(prisma, keyRefs.farm);
      await activateSigningKey(prisma, keyRefs.transporter);
      await activateSigningKey(prisma, keyRefs.retailer);
      const res = await post(
        'farm',
        `/shipments/${shipmentId}/handover-offers/intent`,
        { kind: 'PICKUP' },
      );
      expect(res.status).toBe(409);
      // The shipment keeps working through the regular endpoint.
      await post('transporter', `/shipments/${shipmentId}/start`, {
        version: 0,
        lotVersion: 0,
      }).expect(201);
    });

    it('switches new shipments to DUAL_SIGNED and refuses every A/B and SQL bypass (HYB-AC-23)', async () => {
      await setHandoverMode(prisma, chainId, 'DUAL_SIGNED');
      const { shipmentId, lotId } = await newShipment();
      expect((await shipmentRow(shipmentId)).handoverMode).toBe('DUAL_SIGNED');
      const start = await post(
        'transporter',
        `/shipments/${shipmentId}/start`,
        { version: 0, lotVersion: 0 },
      );
      expect(start.status).toBe(409);
      expect(JSON.stringify(start.body)).toMatch(/HANDOVER_REQUIRED/);
      // Even a direct write cannot move custody without a confirmed handover.
      await expect(
        sql(
          `UPDATE shipment SET status='IN_TRANSIT', version=version+1 WHERE shipment_id='${shipmentId}'`,
        ),
      ).rejects.toThrow(/confirmed PICKUP handover/);
      await expect(
        sql(
          `UPDATE shipment SET handover_mode='STANDARD' WHERE shipment_id='${shipmentId}'`,
        ),
      ).rejects.toThrow(/pinned at creation/);
      expect((await shipmentRow(shipmentId)).status).toBe('CREATED');
      expect((await lotRow(lotId)).currentState).toBe('HARVESTED');
    });

    // ------------------------------------------------------------- pickup
    it('hands over a pickup only after both organizations sign (HYB-AC-15, HYB-AC-23)', async () => {
      const { shipmentId, lotId } = await newShipment();
      const { prepared, res } = await offer('farm', shipmentId, 'PICKUP');
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        state: 'OFFERED',
        kind: 'PICKUP',
        custodyLabel: 'CROSS_ORG',
        quantity: '2.000',
      });
      // The signer can recompute exactly what the key signed.
      expect(prepared.signedMessage).toBe(
        signedMessageForIntent(prepared.intent).toString('base64url'),
      );
      // An offer alone moves nothing: custody and state stay with the farm.
      expect((await shipmentRow(shipmentId)).status).toBe('CREATED');
      expect((await lotRow(lotId)).currentState).toBe('HARVESTED');
      expect(await noEvents(shipmentId, 'SHIPMENT_STARTED')).toBe(0);

      // The giver cannot confirm its own pickup; only the receiver can.
      const handoverId = res.body.data.id as string;
      const own = await post(
        'farm',
        `/handovers/${handoverId}/confirmation/intent`,
      );
      expect(own.status).toBe(403);

      const done = await confirm('transporter', handoverId);
      expect(done.res.status).toBe(201);
      expect(done.res.body.data.state).toBe('CONFIRMED');
      expect((await shipmentRow(shipmentId)).status).toBe('IN_TRANSIT');
      expect((await lotRow(lotId)).currentState).toBe('IN_TRANSPORT');

      // Both signed events and the transition carry the right evidence.
      const events = await prisma.traceEvent.findMany({
        where: {
          entityId: shipmentId,
          eventType: {
            in: ['HANDOVER_OFFERED', 'HANDOVER_CONFIRMED', 'SHIPMENT_STARTED'],
          },
        },
        include: { actorSignature: true, bindingContext: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.eventType)).toEqual([
        'HANDOVER_OFFERED',
        'HANDOVER_CONFIRMED',
        'SHIPMENT_STARTED',
      ]);
      expect(events[0].schemaVersion).toBe('5.0.0');
      expect(events[0].bindingContext?.commitmentVersion).toBe('c2');
      expect(events[0].actorSignature?.organizationId).toBe(orgs.farm);
      expect(events[1].actorSignature?.organizationId).toBe(orgs.transporter);
      expect(events[2].schemaVersion).toBe('3.0.0');
      expect(events[2].actorSignature).toBeNull();
      for (const event of events.slice(0, 2)) {
        const proof = (
          await get('farm', `/trace/events/${event.id}/proof`).expect(200)
        ).body.data;
        expect(proof.localHashMatches).toBe(true);
      }
      // An intent can be used once.
      const again = await signAndSubmit('farm', prepared);
      expect(again.status).toBe(409);
      expect(await noEvents(shipmentId, 'HANDOVER_OFFERED')).toBe(1);
    });

    // ------------------------------------------------------------ arrival
    it('hands over the arrival to the retailer and keeps receive as a separate quantity check', async () => {
      const { shipmentId, lotId } = await newShipment();
      const pickup = await offer('farm', shipmentId, 'PICKUP');
      await confirm('transporter', pickup.res.body.data.id);
      const arrival = await offer('transporter', shipmentId, 'ARRIVAL');
      expect(arrival.res.status).toBe(201);
      expect((await shipmentRow(shipmentId)).status).toBe('IN_TRANSIT');
      // The transporter cannot mark arrival through the regular endpoint.
      const bypass = await post(
        'transporter',
        `/shipments/${shipmentId}/arrive`,
        { version: 1, lotVersion: 1 },
      );
      expect(bypass.status).toBe(409);
      // The retailer cannot receive before arrival is confirmed.
      await post('retailer', `/shipments/${shipmentId}/receive`, {
        version: 1,
        lotVersion: 1,
        receivedQuantity: 2,
      }).expect(409);
      const done = await confirm('retailer', arrival.res.body.data.id);
      expect(done.res.body.data.state).toBe('CONFIRMED');
      expect((await shipmentRow(shipmentId)).status).toBe('ARRIVED');
      expect((await lotRow(lotId)).currentState).toBe('ARRIVED');
      const received = await post(
        'retailer',
        `/shipments/${shipmentId}/receive`,
        {
          version: 2,
          lotVersion: 2,
          receivedQuantity: 2,
        },
      );
      expect(received.status).toBe(201);
    });

    // -------------------------------------------------- reject / cancel
    it('keeps the goods and state when the offer is rejected or cancelled', async () => {
      const { shipmentId, lotId } = await newShipment();
      const first = await offer('farm', shipmentId, 'PICKUP');
      const id = first.res.body.data.id as string;
      // Only the receiver can reject; only the giver can cancel.
      await post('farm', `/handovers/${id}/reject`, {
        reason: 'not mine',
      }).expect(403);
      await post('transporter', `/handovers/${id}/cancel`, {}).expect(403);
      const rejected = await post('transporter', `/handovers/${id}/reject`, {
        reason: 'truck not ready',
      });
      expect(rejected.status).toBe(201);
      expect(rejected.body.data).toMatchObject({
        state: 'REJECTED',
        reason: 'truck not ready',
      });
      expect((await shipmentRow(shipmentId)).status).toBe('CREATED');
      expect((await lotRow(lotId)).currentState).toBe('HARVESTED');
      // A resolved offer cannot be confirmed afterwards.
      const prepared = await post(
        'transporter',
        `/handovers/${id}/confirmation/intent`,
      );
      expect(prepared.status).toBe(409);

      const second = await offer('farm', shipmentId, 'PICKUP');
      const cancelled = await post(
        'farm',
        `/handovers/${second.res.body.data.id}/cancel`,
        { reason: 'changed plan' },
      );
      expect(cancelled.body.data.state).toBe('CANCELLED');
      expect((await shipmentRow(shipmentId)).status).toBe('CREATED');
      // The shipment can still be handed over with a fresh signed offer.
      const third = await offer('farm', shipmentId, 'PICKUP');
      await confirm('transporter', third.res.body.data.id);
      expect((await shipmentRow(shipmentId)).status).toBe('IN_TRANSIT');
      const list = (
        await get('farm', `/shipments/${shipmentId}/handovers`).expect(200)
      ).body.data;
      expect(list.map((h: { state: string }) => h.state).sort()).toEqual([
        'CANCELLED',
        'CONFIRMED',
        'REJECTED',
      ]);
    });

    // ----------------------------------------------------------- expiry
    it('expires an unanswered offer without moving anything', async () => {
      const { shipmentId } = await newShipment();
      const { res, prepared } = await offer('farm', shipmentId, 'PICKUP');
      const id = res.body.data.id as string;
      // The confirmation intent is prepared while the offer is still valid...
      const confirmIntent = (
        await post(
          'transporter',
          `/handovers/${id}/confirmation/intent`,
        ).expect(201)
      ).body.data;
      // ...then the offer lapses before it is submitted.
      await sql(
        'ALTER TABLE shipment_handover DISABLE TRIGGER trg_shipment_handover_guard',
      );
      // Timestamps are written like the application writes them (driver-encoded Dates).
      await prisma.$executeRaw`UPDATE shipment_handover SET offered_at = ${new Date(Date.now() - 2 * 86_400_000)}, expires_at = ${new Date(Date.now() - 3_600_000)} WHERE handover_id = ${id}::uuid`;
      await sql(
        'ALTER TABLE shipment_handover ENABLE TRIGGER trg_shipment_handover_guard',
      );
      const late = await signAndSubmit('transporter', confirmIntent);
      expect(late.status).toBe(409);
      const row = await prisma.shipmentHandover.findUniqueOrThrow({
        where: { id },
      });
      expect(row.state).toBe('EXPIRED');
      expect(row.resolvedBy).toBeNull();
      expect((await shipmentRow(shipmentId)).status).toBe('CREATED');
      expect(await noEvents(shipmentId, 'HANDOVER_CONFIRMED')).toBe(0);
      expect(prepared.intent.eventType).toBe('HANDOVER_OFFERED');
    });

    // ------------------------------------------------------ stale version
    it('voids an offer when the shipment or lot changes before confirmation', async () => {
      const { shipmentId, lotId } = await newShipment(4);
      const pickup = await offer('farm', shipmentId, 'PICKUP');
      await confirm('transporter', pickup.res.body.data.id);
      const arrival = await offer('transporter', shipmentId, 'ARRIVAL');
      const confirmIntent = (
        await post(
          'retailer',
          `/handovers/${arrival.res.body.data.id}/confirmation/intent`,
        ).expect(201)
      ).body.data;
      // The transporter records a partial damage after offering: the quantity and versions move.
      await post('transporter', `/shipments/${shipmentId}/damage`, {
        version: 1,
        lotVersion: 1,
        quantity: 1,
        reason: 'crushed boxes',
      }).expect(201);
      const stale = await signAndSubmit('retailer', confirmIntent);
      expect(stale.status).toBe(409);
      expect((await shipmentRow(shipmentId)).status).toBe('IN_TRANSIT');
      expect((await lotRow(lotId)).currentState).toBe('IN_TRANSPORT');
      expect(await noEvents(shipmentId, 'HANDOVER_CONFIRMED')).toBe(1);
      // A new preparation is also refused until the old offer is withdrawn.
      expect(
        (
          await post(
            'retailer',
            `/handovers/${arrival.res.body.data.id}/confirmation/intent`,
          )
        ).status,
      ).toBe(409);
      await post(
        'transporter',
        `/handovers/${arrival.res.body.data.id}/cancel`,
        {},
      ).expect(201);
      const fresh = await offer('transporter', shipmentId, 'ARRIVAL');
      expect(fresh.res.body.data.quantity).toBe('3.000');
      await confirm('retailer', fresh.res.body.data.id);
      expect((await shipmentRow(shipmentId)).status).toBe('ARRIVED');
    });

    // -------------------------------------------- signature negatives (14)
    it('rolls back a signed command if its event payload differs from the displayed quantity', async () => {
      const { shipmentId } = await newShipment();
      const prepared = (await prepare('farm', `/shipments/${shipmentId}/handover-offers/intent`, { kind: 'PICKUP', keyRef: keyRefs.farm }).expect(201)).body.data;
      const trace = app.get(TraceService);
      const original = trace.createInTransaction.bind(trace);
      const spy = vi.spyOn(trace, 'createInTransaction').mockImplementationOnce((tx, input) => original(tx, {
        ...input, businessData: { ...(input.businessData as Record<string, string>), quantity: '999.000' },
      }));
      try {
        await signAndSubmit('farm', prepared).then((response) => expect(response.status).toBe(409));
      } finally { spy.mockRestore(); }
      expect((await prisma.signingIntent.findUniqueOrThrow({ where: { id: prepared.intentId } })).status).toBe('PENDING');
      expect(await noEvents(shipmentId, 'HANDOVER_OFFERED')).toBe(0);
      expect((await shipmentRow(shipmentId)).status).toBe('CREATED');
      await signAndSubmit('farm', prepared).then((response) => expect(response.status).toBe(201));
    });

    it('enforces signed content parity in SQL even if insertion bypasses the trace encoder', async () => {
      let sqlFailure: unknown;
      const { shipmentId } = await newShipment();
      const prepared = (await prepare('farm', `/shipments/${shipmentId}/handover-offers/intent`, { kind: 'PICKUP', keyRef: keyRefs.farm }).expect(201)).body.data;
      const trace = app.get(TraceService);
      const original = trace.createInTransaction.bind(trace);
      const spy = vi.spyOn(trace, 'createInTransaction').mockImplementationOnce((tx, input) => {
        const create = tx.traceEvent.create.bind(tx.traceEvent);
        const poisoned = { ...tx, traceEvent: { ...tx.traceEvent, create: (args: Parameters<typeof create>[0]) => create({
          ...args, data: { ...args.data, businessData: { ...(args.data.businessData as Record<string, string>), quantity: '999.000' } },
        }) } } as unknown as typeof tx;
        return original(poisoned, input).catch((error) => { sqlFailure = error; throw error; });
      });
      try {
        await signAndSubmit('farm', prepared).then((response) => expect(response.status).toBe(500));
      } finally { spy.mockRestore(); }
      expect(String(sqlFailure)).toMatch(/Signed event business content differs from its consumed intent/);
      expect((await prisma.signingIntent.findUniqueOrThrow({ where: { id: prepared.intentId } })).status).toBe('PENDING');
      expect(await noEvents(shipmentId, 'HANDOVER_OFFERED')).toBe(0);
      expect((await shipmentRow(shipmentId)).status).toBe('CREATED');
    });

    it('rejects wrong signers, tampered intents, foreign users, replays and expired intents (HYB-AC-14)', async () => {
      const { shipmentId } = await newShipment();
      const events = () =>
        prisma.traceEvent.count({ where: { entityId: shipmentId } });
      const baseline = await events();
      const prepare1 = async () =>
        (
          await post(
            'farm',
            `/shipments/${shipmentId}/handover-offers/intent`,
            { kind: 'PICKUP' },
          ).expect(201)
        ).body.data;

      // A signature by another organization's key does not verify.
      const a = await prepare1();
      expect((await signAndSubmit('farm', a, signers.transporter)).status).toBe(
        422,
      );
      // A signature over a modified intent (different version) does not verify.
      const tampered = { ...a.intent, expectedVersion: '9' };
      const forged = signers.farm.signIntent(tampered);
      expect(
        (
          await post('farm', `/signing-intents/${a.intentId}/submit`, {
            signature: forged,
          })
        ).status,
      ).toBe(422);
      // A malformed signature never reaches the domain.
      expect(
        (
          await post('farm', `/signing-intents/${a.intentId}/submit`, {
            signature: 'short',
          })
        ).status,
      ).toBe(400);
      // Another user cannot submit someone else's prepared intent.
      expect((await signAndSubmit('transporter', a, signers.farm)).status).toBe(
        403,
      );
      // None of this created an event, a handover or consumed the intent.
      expect(await events()).toBe(baseline);
      expect(
        (
          await prisma.signingIntent.findUniqueOrThrow({
            where: { id: a.intentId },
          })
        ).status,
      ).toBe('PENDING');
      expect(
        await prisma.shipmentHandover.count({ where: { shipmentId } }),
      ).toBe(0);

      // The valid signature still works once; a replay with a new idempotency key does not.
      expect((await signAndSubmit('farm', a)).status).toBe(201);
      expect((await signAndSubmit('farm', a)).status).toBe(409);

      // An expired intent cannot be submitted.
      await post(
        'farm',
        `/handovers/${(await prisma.shipmentHandover.findFirstOrThrow({ where: { shipmentId } })).id}/cancel`,
        {},
      ).expect(201);
      const b = await prepare1();
      await sql(
        'ALTER TABLE signing_intent DISABLE TRIGGER trg_signing_intent_guard',
      );
      await prisma.$executeRaw`UPDATE signing_intent SET expires_at = ${new Date(Date.now() - 60_000)} WHERE intent_id = ${b.intentId}::uuid`;
      await sql(
        'ALTER TABLE signing_intent ENABLE TRIGGER trg_signing_intent_guard',
      );
      expect((await signAndSubmit('farm', b)).status).toBe(409);

      // A key revoked after preparation cannot sign any more (signer outage / key loss).
      const c = await prepare1();
      await post(
        'farm',
        `/supply-chains/${chainId}/signing-keys/${keyRefs.farm}/revoke`,
        { reason: 'laptop lost' },
      ).expect(201);
      expect((await signAndSubmit('farm', c)).status).toBe(409);
      expect(
        (
          await post(
            'farm',
            `/shipments/${shipmentId}/handover-offers/intent`,
            { kind: 'PICKUP' },
          )
        ).status,
      ).toBe(409);
      // The revoked key was ACTIVE, so the ledger withdrawal is queued for the Worker.
      expect(
        await prisma.ledgerControlJob.count({
          where: {
            signingKeyRef: keyRefs.farm,
            operation: 'SIGNING_KEY_REVOKE',
          },
        }),
      ).toBe(1);
      // Rotate: a new key is enrolled and activated before work continues.
      const rotated = await enroll('farm');
      expect(rotated.res.status).toBe(201);
      await activateSigningKey(prisma, rotated.keyRef);
      keyRefs.farm = rotated.keyRef;
      signers.farm = rotated.signer;
      const d = await prepare1();
      expect(d.keyRef).toBe(rotated.keyRef);
      expect((await signAndSubmit('farm', d)).status).toBe(201);
    });

    // ------------------------------------------------------ SQL guards
    it('enforces the handover invariants in SQL, independent of the service', async () => {
      const { shipmentId } = await newShipment();
      const cancelledOffer = await offer('farm', shipmentId, 'PICKUP');
      const id = cancelledOffer.res.body.data.id as string;
      // Terms of an offer and its resolution rules are immutable.
      await expect(
        sql(
          `UPDATE shipment_handover SET quantity = 1 WHERE handover_id='${id}'`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        sql(
          `UPDATE shipment_handover SET state='CONFIRMED', resolved_at=now(), version=version+1 WHERE handover_id='${id}'`,
        ),
      ).rejects.toThrow();
      // The receiver cannot be turned into the giver; same-org label must match.
      await expect(
        sql(
          `UPDATE shipment_handover SET custody_label='INTERNAL_SAME_ORG' WHERE handover_id='${id}'`,
        ),
      ).rejects.toThrow();
      // Only one open offer per shipment.
      await expect(
        offer('farm', shipmentId, 'PICKUP').then((r) => {
          if (r.res.status >= 400) throw new Error(String(r.res.status));
        }),
      ).rejects.toThrow('409');
      // Signing keys and intents are never deleted or rewritten.
      await expect(
        sql(`DELETE FROM signing_key WHERE key_ref='${keyRefs.transporter}'`),
      ).rejects.toThrow(/never deleted/);
      await expect(
        sql(
          `UPDATE signing_key SET public_key = '${'A'.repeat(59)}', version=version+1 WHERE key_ref='${keyRefs.transporter}'`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        sql(
          `UPDATE signing_key SET status='PENDING_LEDGER', version=version+1 WHERE key_ref='${keyRefs.transporter}'`,
        ),
      ).rejects.toThrow(/Illegal signing key transition/);
      await expect(
        sql(
          `UPDATE signing_intent SET payload_digest='${'0'.repeat(64)}' WHERE intent_id='${cancelledOffer.prepared.intentId}'`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        sql(
          `UPDATE event_actor_signature SET signature='${'A'.repeat(86)}' WHERE intent_id='${cancelledOffer.prepared.intentId}'`,
        ),
      ).rejects.toThrow(/immutable/);
      // A handover event written without its signature row is refused at commit,
      // even when everything else about the event is valid.
      const trace = app.get(TraceService);
      const shipment = await prisma.shipment.findUniqueOrThrow({
        where: { id: shipmentId },
      });
      await expect(
        prisma.$transaction((tx) =>
          trace.createInTransaction(tx, {
            entityType: 'SHIPMENT',
            entityId: shipmentId,
            lotId: shipment.lotId,
            eventType: 'HANDOVER_CONFIRMED',
            actor: {
              sub: users.farm,
              organizationId: orgs.farm,
              role: 'FARM_STAFF',
            },
            businessData: { forged: true },
          }),
        ),
      ).rejects.toThrow(/requires an organization signature/);
    });

    it('works with a key held outside AgriTrace through the reference signer', async () => {
      // A second active key makes the choice explicit: no silent default.
      const external = generateSignerKey();
      const body = registrationBody(external.privatePem, {
        bindingDigest: digest,
        organizationId: orgs.transporter,
        label: 'Dịch vụ ký ngoài',
      });
      await post(
        'transporter',
        `/supply-chains/${chainId}/signing-keys`,
        body,
      ).expect(201);
      await activateSigningKey(prisma, body.keyRef);
      const { shipmentId } = await newShipment();
      const pickup = await offer('farm', shipmentId, 'PICKUP');
      const handoverId = pickup.res.body.data.id as string;
      const ambiguous = await post(
        'transporter',
        `/handovers/${handoverId}/confirmation/intent`,
      );
      expect(ambiguous.status).toBe(409);
      expect(JSON.stringify(ambiguous.body)).toMatch(/keyRef/);
      const prepared = (
        await post(
          'transporter',
          `/handovers/${handoverId}/confirmation/intent`,
          {
            keyRef: body.keyRef,
          },
        ).expect(201)
      ).body.data;
      // The external signer sees only the prepared intent and its own PEM key.
      const { signature } = signPreparedIntent(external.privatePem, prepared);
      const done = await post(
        'transporter',
        `/signing-intents/${prepared.intentId}/submit`,
        {
          signature,
        },
      );
      expect(done.status).toBe(201);
      expect(done.body.data.state).toBe('CONFIRMED');
      const signed = await prisma.eventActorSignature.findFirstOrThrow({
        where: { intentId: prepared.intentId },
      });
      expect(signed.keyRef).toBe(body.keyRef);
      expect((await shipmentRow(shipmentId)).status).toBe('IN_TRANSIT');
    });

    it('keeps same-organization pickup/arrival labelled internal and derives custody stage independently of organization ID', async () => {
      for (const code of ['TRANSPORTER', 'RETAILER'] as const) {
        await prisma.organizationCapability.upsert({
          where: { organizationId_code: { organizationId: orgs.farm, code } },
          create: { organizationId: orgs.farm, code }, update: {},
        });
        await prisma.$transaction(async (tx) => {
          const grant = await tx.scopedRoleGrant.create({ data: {
            userId: users.farm, organizationId: orgs.farm, chainId, scope: 'CHAIN', role: code,
          } });
          await requestLedgerGrant(tx, grant);
        });
      }
      // This suite is API+SQL only; confirmed permission fixtures do not claim
      // real registry acceptance. The Fabric suite verifies those separately.
      await confirmPermissions();
      const { shipmentId, lotId } = await newShipment(2, true);
      for (const kind of ['PICKUP', 'ARRIVAL'] as const) {
        const offered = await offer('farm', shipmentId, kind);
        expect(offered.res.status).toBe(201);
        expect(offered.res.body.data).toMatchObject({ giverOrgId: orgs.farm, receiverOrgId: orgs.farm, custodyLabel: 'INTERNAL_SAME_ORG' });
        const confirmed = await confirm('farm', offered.res.body.data.id);
        expect(confirmed.res.status).toBe(201);
        expect(confirmed.res.body.data).toMatchObject({ state: 'CONFIRMED', custodyLabel: 'INTERNAL_SAME_ORG' });
      }
      expect((await shipmentRow(shipmentId)).status).toBe('ARRIVED');
      const detail = await get('farm', `/lots/${lotId}`).expect(200);
      expect(detail.body.data.custodian).toMatchObject({ organizationId: orgs.farm, role: 'RETAILER' });
      expect(await noEvents(shipmentId, 'HANDOVER_CONFIRMED')).toBe(2);
    });

    it('reconciles signed submit using the original signature/body/key and denies replay after current authority is revoked', async () => {
      const { shipmentId } = await newShipment();
      const prepared = (await post('staff', `/shipments/${shipmentId}/handover-offers/intent`, { kind: 'PICKUP', keyRef: keyRefs.farm }).expect(201)).body.data;
      const body = { signature: signers.farm.signIntent(prepared.intent) };
      const key = randomUUID();
      const token = jwt.sign({ sub: users.staff, sid: sessions.staff });
      const send = (path: string, payload: object) => request(app.getHttpServer()).post(`/api${path}`)
        .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(payload);
      await send(`/signing-intents/${prepared.intentId}/submit`, body).expect(201);
      const status = await send('/command-requests/status', {
        operation: 'SUBMIT_SIGNED_INTENT', payload: { intentId: prepared.intentId, ...body },
      }).expect(200);
      expect(status.body.data).toMatchObject({ status: 'COMMITTED', result: { shipmentId, state: 'OFFERED' } });
      expect(await noEvents(shipmentId, 'HANDOVER_OFFERED')).toBe(1);
      await send(`/signing-intents/${prepared.intentId}/submit`, body).expect(201);
      expect(await noEvents(shipmentId, 'HANDOVER_OFFERED')).toBe(1);
      const permission = await prisma.scopedRoleGrant.findFirstOrThrow({ where: {
        userId: users.staff, chainId, role: 'FARM_STAFF', revokedAt: null,
      } });
      await prisma.scopedRoleGrant.update({ where: { id: permission.id }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
      await send('/command-requests/status', { operation: 'SUBMIT_SIGNED_INTENT', payload: { intentId: prepared.intentId, ...body } }).expect(403);
      await get('staff', `/signing-intents/${prepared.intentId}`).expect(404);
      expect(await noEvents(shipmentId, 'HANDOVER_OFFERED')).toBe(1);
    });

    it('refuses to switch the chain mode while a handover is open', async () => {
      const { shipmentId } = await newShipment();
      await offer('farm', shipmentId, 'PICKUP');
      await expect(
        setHandoverMode(prisma, chainId, 'STANDARD'),
      ).rejects.toThrow(/handover is open/);
    });
  },
);
