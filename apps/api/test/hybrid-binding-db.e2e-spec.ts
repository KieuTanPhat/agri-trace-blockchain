import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  activateBinding,
  recordCredential,
  registerBinding,
  revokeCredentialRecord,
} from '../src/modules/ledger/ledger-bindings.js';
import {
  ledgerEntityTypes,
  requestLedgerGrant,
  requestLedgerRevoke,
  reserveEventPermission,
} from '../src/modules/ledger/ledger-permissions.js';
import { provisionChain } from './support/chain-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      connectionString ?? 'postgresql://unused@localhost/unused',
  }),
});
const sql = (text: string) => prisma.$executeRawUnsafe(text);
const rejects = async (run: () => Promise<unknown>, message?: RegExp) => {
  await expect(run()).rejects.toThrow(message);
};
const FINGERPRINT = 'ab'.repeat(32);

(connectionString ? describe : describe.skip)(
  'Release B database guards (no Fabric)',
  () => {
    let chainId: string;
    let owner: { org: string; user: string };
    let digest: string;
    let grantId: string;
    let permissionRef: string;

    beforeAll(async () => {
      const role = await prisma.role.upsert({
        where: { code: 'FARM_STAFF' },
        create: { code: 'FARM_STAFF', name: 'FARM_STAFF' },
        update: {},
      });
      const org = await prisma.organization.create({
        data: { name: `B guards ${randomUUID()}`, type: 'FARM' },
      });
      const user = await prisma.user.create({
        data: {
          fullName: 'B guard farmer',
          email: `b-guard-${randomUUID()}@example.test`,
          roleId: role.id,
          organizationId: org.id,
          passwordHash: 'not-a-login-fixture',
        },
      });
      owner = { org: org.id, user: user.id };
      chainId = await provisionChain(prisma, {
        ownerOrganizationId: org.id,
        memberOrganizationIds: [],
        grants: [
          { userId: user.id, organizationId: org.id, role: 'FARM_STAFF' },
        ],
      });
      grantId = (
        await prisma.scopedRoleGrant.findFirstOrThrow({
          where: { chainId, userId: user.id, role: 'FARM_STAFF' },
        })
      ).id;
      const registered = await prisma.$transaction((tx) =>
        registerBinding(tx, {
          chainId,
          network: 'db-guard-fixture',
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
    });

    afterAll(async () => prisma.$disconnect());

    it('keeps a new binding PENDING and refuses activation without an approved credential', async () => {
      expect(
        (
          await prisma.fabricBindingState.findUniqueOrThrow({
            where: { bindingDigest: digest },
          })
        ).status,
      ).toBe('PENDING');
      await rejects(
        () => prisma.$transaction((tx) => activateBinding(tx, digest)),
        /credential/,
      );
      await prisma.$transaction((tx) =>
        recordCredential(tx, digest, FINGERPRINT),
      );
    });

    it('does not let a PENDING binding become the chain profile or a cycle origin', async () => {
      await rejects(
        () =>
          sql(
            `UPDATE chain_ledger_profile SET active_binding_digest='${digest}', version=version+1 WHERE chain_id='${chainId}'`,
          ),
        /ACTIVE binding/,
      );
    });

    it('activates the binding and queues one ledger grant per ledger role grant', async () => {
      const result = await prisma.$transaction((tx) =>
        activateBinding(tx, digest),
      );
      expect(result.requestedPermissions).toBe(1);
      const sync = await prisma.ledgerPermissionSync.findFirstOrThrow({
        where: { permission: { bindingDigest: digest } },
        include: { permission: true },
      });
      permissionRef = sync.permissionRef;
      expect(sync).toMatchObject({
        state: 'REQUESTED',
        requestedEpoch: 1,
        confirmedEpoch: null,
      });
      expect(
        await prisma.ledgerControlJob.count({
          where: {
            permissionRef,
            operation: 'PERMISSION_GRANT',
            expectedRevision: 0,
          },
        }),
      ).toBe(1);
      // Re-activation is idempotent: no second grant is queued for the same grant row.
      expect(
        (await prisma.$transaction((tx) => activateBinding(tx, digest)))
          .requestedPermissions,
      ).toBe(0);
    });

    it('refuses to capture a permission that the ledger has not confirmed (no write opens)', async () => {
      await rejects(
        () =>
          prisma.$transaction((tx) =>
            reserveEventPermission(
              tx,
              digest,
              { sub: owner.user, role: 'FARM_STAFF' },
              'PRODUCTION_CYCLE',
            ),
          ),
        /chưa được xác nhận/,
      );
      await rejects(
        () =>
          sql(
            `INSERT INTO event_permission_epoch(event_id,permission_ref,epoch,ordinal) VALUES (gen_random_uuid(),'${permissionRef}',1,1)`,
          ),
        /./,
      );
    });

    it('enforces the permission state machine and the confirmation rule in SQL', async () => {
      const update = (set: string) =>
        sql(
          `UPDATE ledger_permission_sync SET ${set}, version=version+1 WHERE permission_ref='${permissionRef}'`,
        );
      await rejects(
        () => update(`state='ACTIVE', confirmed_epoch=1`),
        /Invalid permission sync transition/,
      );
      await update(`state='PENDING_LEDGER'`);
      await rejects(
        () => update(`state='ACTIVE'`),
        /ledger-confirmed requested epoch/,
      );
      await rejects(() => update(`state='REVOKE_REQUESTED'`), /barrier/);
      await rejects(() => update(`state='ACTIVE', confirmed_epoch=2`), /./);
      await update(`state='ACTIVE', confirmed_epoch=1`);
      await rejects(
        () =>
          sql(
            `UPDATE ledger_permission_sync SET version=version+2 WHERE permission_ref='${permissionRef}'`,
          ),
        /Invalid permission sync update/,
      );
      await rejects(
        () =>
          sql(
            `UPDATE ledger_permission_sync SET next_ordinal=0, version=version+1 WHERE permission_ref='${permissionRef}'`,
          ),
        /./,
      );
    });

    it('reserves strictly increasing ordinals under the permission lock once ACTIVE', async () => {
      const first = await prisma.$transaction((tx) =>
        reserveEventPermission(
          tx,
          digest,
          { sub: owner.user, role: 'FARM_STAFF' },
          'PRODUCTION_CYCLE',
        ),
      );
      const second = await prisma.$transaction((tx) =>
        reserveEventPermission(
          tx,
          digest,
          { sub: owner.user, role: 'FARM_STAFF' },
          'CARE',
        ),
      );
      expect([first.ordinal, second.ordinal]).toEqual([1n, 2n]);
      expect(first.epoch).toBe(1);
      await rejects(
        () =>
          prisma.$transaction((tx) =>
            reserveEventPermission(
              tx,
              digest,
              { sub: owner.user, role: 'FARM_STAFF' },
              'LOT_UNKNOWN',
            ),
          ),
        /không bao phủ/,
      );
      await rejects(
        () =>
          prisma.$transaction((tx) =>
            reserveEventPermission(
              tx,
              digest,
              { sub: owner.user, role: 'TRANSPORTER' },
              'SHIPMENT',
            ),
          ),
        /Chưa có quyền ledger/,
      );
    });

    it('revoke captures the barrier, schedules a revoke job and blocks new captures', async () => {
      await prisma.$transaction(async (tx) => {
        await tx.scopedRoleGrant.update({
          where: { id: grantId },
          data: { revokedAt: new Date(), revision: { increment: 1 } },
        });
        const result = await requestLedgerRevoke(tx, grantId, 'NORMAL', 'test');
        expect(result).toMatchObject({
          outcome: 'REVOKE_REQUESTED',
          barrierOrdinal: 2n,
        });
      });
      const sync = await prisma.ledgerPermissionSync.findUniqueOrThrow({
        where: { permissionRef },
      });
      expect(sync).toMatchObject({
        state: 'REVOKE_REQUESTED',
        barrierOrdinal: 2n,
      });
      expect(
        await prisma.ledgerControlJob.count({
          where: {
            permissionRef,
            operation: 'PERMISSION_REVOKE',
            expectedRevision: 1,
          },
        }),
      ).toBe(1);
      await rejects(
        () =>
          prisma.$transaction((tx) =>
            reserveEventPermission(
              tx,
              digest,
              { sub: owner.user, role: 'FARM_STAFF' },
              'CARE',
            ),
          ),
        /chưa được xác nhận|thu hồi/,
      );
      // A second revoke of the same epoch changes nothing.
      expect(
        await prisma.$transaction((tx) =>
          requestLedgerRevoke(tx, grantId, 'NORMAL'),
        ),
      ).toMatchObject({ outcome: 'NO_CHANGE' });
    });

    it('regrant needs the next epoch; a fresh grant row cannot reuse an epoch', async () => {
      const update = (set: string) =>
        sql(
          `UPDATE ledger_permission_sync SET ${set}, version=version+1 WHERE permission_ref='${permissionRef}'`,
        );
      await update(`state='DRAINING'`);
      await update(`state='PENDING_REVOKE_LEDGER'`);
      await update(`state='REVOKED'`);
      const fresh = await prisma.scopedRoleGrant.create({
        data: {
          userId: owner.user,
          organizationId: owner.org,
          chainId,
          scope: 'CHAIN',
          role: 'FARM_STAFF',
        },
      });
      const requested = await prisma.$transaction((tx) =>
        requestLedgerGrant(tx, fresh),
      );
      expect(requested).toMatchObject({ epoch: 2 });
      expect(
        await prisma.ledgerControlJob.count({
          where: {
            permissionRef,
            operation: 'PERMISSION_GRANT',
            expectedRevision: 2,
          },
        }),
      ).toBe(1);
      await rejects(
        () => prisma.$transaction((tx) => requestLedgerGrant(tx, fresh)),
        /chưa được thu hồi xong/,
      );
    });

    it('keeps bindings, route definitions and attempts append-only', async () => {
      await rejects(
        () =>
          sql(
            `UPDATE fabric_network_binding SET network='forged' WHERE digest='${digest}'`,
          ),
        /./,
      );
      await rejects(
        () =>
          sql(`DELETE FROM fabric_network_binding WHERE digest='${digest}'`),
        /./,
      );
      const credential = await prisma.fabricCredentialRevision.findFirstOrThrow(
        { where: { bindingDigest: digest } },
      );
      await prisma.$transaction((tx) =>
        revokeCredentialRecord(tx, digest, credential.certFingerprint),
      );
      await rejects(
        () =>
          sql(
            `UPDATE fabric_credential_revision SET status='APPROVED', revoked_at=NULL WHERE credential_id='${credential.id}'`,
          ),
        /./,
      );
      await rejects(
        () =>
          sql(`INSERT INTO ledger_route_definition(digest,protocol,mode,network,channel_id,chaincode_name,contract_name,envelope_version,writer_authority,writer_msp_id,writer_role)
          VALUES (repeat('e',64),'agritrace-ledger-route/2','WRITE','n','c','cc','ct','4.0.0','a','m','relayer')`),
        /./,
      );
    });

    it('opens a delivery hold once and resolves it exactly once', async () => {
      const hold = await prisma.deliveryHold.create({
        data: {
          bindingDigest: digest,
          scope: 'BINDING',
          reason: 'operator pause',
        },
      });
      await prisma.deliveryHold.update({
        where: { id: hold.id },
        data: { resolvedAt: new Date(), resolution: 'reviewed' },
      });
      await rejects(
        () =>
          prisma.deliveryHold.update({
            where: { id: hold.id },
            data: { resolution: 'changed', resolvedAt: new Date() },
          }),
        /./,
      );
      await rejects(
        () =>
          sql(
            `INSERT INTO delivery_hold(binding_digest,scope,reason) VALUES ('${digest}','PERMISSION','missing selector')`,
          ),
        /./,
      );
    });

    it('maps only writing roles to ledger entity types and keeps them sorted', () => {
      for (const role of [
        'FARM_STAFF',
        'TRANSPORTER',
        'RETAILER',
        'CHAIN_MANAGER',
        'COMPLIANCE_REVIEWER',
      ] as const) {
        const types = ledgerEntityTypes(role)!;
        expect([...types].sort()).toEqual(types);
      }
      for (const role of ['ORG_ADMIN', 'CREATE_CHAIN', 'AUDITOR'] as const)
        expect(ledgerEntityTypes(role)).toBeNull();
    });
  },
);
