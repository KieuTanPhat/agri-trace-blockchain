import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  authorizeCommand,
  type AuthorizedCommand,
  type CommandActor,
} from '../src/common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../src/common/crypto/rfc8785.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import { inventoryLegacyScope } from '../src/modules/supply-chains/legacy-scope-inventory.js';
import { planLegacyScopeAssignments } from '../src/modules/supply-chains/legacy-scope-plan.js';
import {
  applyLegacyScopeRoot,
  confirmLegacyScopeProposal,
  legacyReviewKeys,
  registerLegacyScopeManifest,
} from '../src/modules/supply-chains/legacy-scope.commands.js';
import {
  installLegacyPin,
  legacyHistoryFixture,
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
type Input = AuthorizedCommand & { idempotencyKey: string };

beforeAll(() => expect(process.env.HYBRID_DRAFT_TESTS).toBe('1'));
afterAll(() => db.$disconnect());

async function isolated(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error('successful-bridge-scenario-rollback');
  try {
    await db.$transaction(
      async (tx) => {
        await work(tx);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        throw rollback;
      },
      { timeout: 30000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
async function session(tx: Prisma.TransactionClient, actor: CommandActor) {
  const value = await tx.refreshSession.create({
    data: {
      userId: actor.sub!,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { ...actor, sid: value.id };
}
function inspection(tx: Prisma.TransactionClient) {
  // Keep each scenario in its rollback transaction; inspect itself never executes.
  return new IdempotencyService(
    new Proxy(tx as unknown as PrismaService, {
      get(target, key) {
        if (key === '$transaction')
          return (
            work: (value: Prisma.TransactionClient) => Promise<unknown>,
          ) => work(tx);
        return Reflect.get(target, key);
      },
    }),
  );
}
async function positiveJournal(
  tx: Prisma.TransactionClient,
  input: Input,
  result: object,
) {
  const scope = await authorizeCommand(tx, input, true);
  const record = await tx.idempotencyRecord.create({
    data: {
      requesterId: input.requesterId,
      operation: input.operation,
      requestType: 'ISOLATED_BRIDGE_FIXTURE',
      idempotencyKey: input.idempotencyKey,
      requestHash: canonicalSha256(input.payload),
      authorizationScope: scope,
      status: 'PROCESSING',
    },
  });
  const journal = await tx.commandCommit.create({
    data: {
      idempotencyRecordId: record.id,
      requesterId: input.requesterId,
      operation: input.operation,
      authorizationScope: scope,
      actorScope: {
        role: input.businessActor?.role ?? input.actor?.role ?? 'IOT_DEVICE',
        organizationId: input.actor?.organizationId ?? null,
      },
      resourceIds: { result },
      responseStatus: 201,
      responseBody: result,
    },
  });
  return { record, journal };
}
async function cutover(
  tx: Prisma.TransactionClient,
  f: Fixture,
  work: () => Promise<void>,
) {
  // Additions to device/history fixtures require a new reviewed inventory/pin.
  const inventory = await inventoryLegacyScope(tx);
  f.pin.manifest.inventoryDigest = inventory.digest;
  f.pin.manifest.entries = f.pin.manifest.entries.map((entry) => ({
    ...entry,
    inventoryDigest: inventory.roots.find(
      (root) => root.cycleId === entry.cycleId,
    )!.inventoryDigest,
  }));
  f.pin.digest = canonicalSha256(f.pin.manifest);
  f.pin.plan = await planLegacyScopeAssignments(
    tx,
    f.pin.manifest,
    inventory,
    f.pin.digest,
    { environment: 'isolated', sourceSha: f.pin.manifest.sourceSha },
  );
  const pins = installLegacyPin(f.pin);
  try {
    await registerLegacyScopeManifest(tx, f.operator, f.pin.manifest.id);
    for (const key of Object.keys(legacyReviewKeys(f.pin)))
      await confirmLegacyScopeProposal(tx, f.producer, f.pin.manifest.id, key);
    for (const p of f.pin.plan.proposals)
      await confirmLegacyScopeProposal(
        tx,
        f.actors.find((actor) => actor.organizationId === p.organizationId)!,
        f.pin.manifest.id,
        p.key,
      );
    for (const cycle of f.cycles)
      await applyLegacyScopeRoot(tx, f.operator, f.pin.manifest.id, cycle.id);
    await tx.chainBusinessProfile.update({
      where: { chainId: f.chain.id },
      data: { state: 'ACTIVE', version: { increment: 1 } },
    });
    await work();
  } finally {
    pins.restore();
  }
}

describe('Legacy replay authority witnesses', () => {
  it.each(['grant', 'assignment'] as const)(
    'bridges the original independent reviewer but holds a replacement %s',
    (changed) =>
      isolated(async (tx) => {
        const f = await legacyHistoryFixture(tx, trace);
        const role = await tx.role.upsert({
          where: { code: 'COMPLIANCE_REVIEWER' },
          update: {},
          create: { code: 'COMPLIANCE_REVIEWER', name: 'Reviewer' },
        });
        const org = await tx.organization.create({
          data: { name: randomUUID(), type: 'AUDITOR' },
        });
        const user = await tx.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            fullName: 'Isolated reviewer',
            passwordHash: 'unused',
            organizationId: org.id,
            roleId: role.id,
          },
        });
        const farmId = f.cycles[0].farmId;
        const assignment = await tx.complianceAssignment.create({
          data: { reviewerUserId: user.id, farmId },
        });
        await tx.chainMembership.create({
          data: {
            chainId: f.chain.id,
            organizationId: org.id,
            status: 'ACTIVE',
          },
        });
        const grant = await tx.scopedRoleGrant.create({
          data: {
            scope: 'CHAIN',
            chainId: f.chain.id,
            userId: user.id,
            organizationId: org.id,
            role: 'COMPLIANCE_REVIEWER',
          },
        });
        const actor = await session(tx, {
          sub: user.id,
          organizationId: org.id,
          role: 'COMPLIANCE_REVIEWER',
        });
        const input: Input = {
          actor,
          requesterId: user.id,
          idempotencyKey: randomUUID(),
          operation: 'CREATE_INSPECTION',
          payload: { lotId: f.lotIds[0], note: 'private original' },
        };
        const before = await positiveJournal(tx, input, {
          id: randomUUID(),
          note: 'private committed fixture',
        });
        await cutover(tx, f, async () => {
          const idem = inspection(tx);
          expect(await idem.inspectCommand(input)).toMatchObject({
            status: 'COMMITTED',
            result: before.journal.responseBody,
          });
          expect(
            (
              await tx.legacyCommandBridge.findUniqueOrThrow({
                where: { commandCommitId: before.journal.id },
              })
            ).protocolVersion,
          ).toBe(2);
          if (changed === 'grant') {
            await tx.scopedRoleGrant.update({
              where: { id: grant.id },
              data: { revokedAt: new Date(), revision: { increment: 1 } },
            });
            await tx.scopedRoleGrant.create({
              data: {
                scope: 'CHAIN',
                chainId: f.chain.id,
                userId: user.id,
                organizationId: org.id,
                role: 'COMPLIANCE_REVIEWER',
              },
            });
          } else {
            await tx.complianceAssignment.update({
              where: { id: assignment.id },
              data: { revokedAt: new Date() },
            });
            await tx.complianceAssignment.create({
              data: { reviewerUserId: user.id, farmId },
            });
          }
          await expect(idem.inspectCommand(input)).rejects.toBeInstanceOf(
            ConflictException,
          );
          expect(
            await tx.commandCommit.findUnique({
              where: { id: before.journal.id },
            }),
          ).toEqual(before.journal);
        });
      }),
  );

  it.each(['sensor', 'telemetry'] as const)(
    'bridges a registered %s gateway while preserving device and binding epochs',
    (kind) =>
      isolated(async (tx) => {
        const f = await legacyHistoryFixture(tx, trace);
        const shipment = await tx.shipment.findUniqueOrThrow({
          where: { lotId: f.lotIds[0] },
        });
        const device = await tx.iotDevice.create({
          data: {
            deviceCode: randomUUID(),
            name: 'Isolated device',
            type: kind,
            organizationId:
              kind === 'sensor'
                ? f.producer.organizationId!
                : f.transporter.organizationId!,
            cycleId: kind === 'sensor' ? f.cycles[0].id : null,
          },
        });
        const binding =
          kind === 'telemetry'
            ? await tx.shipmentTrackingBinding.create({
                data: {
                  shipmentId: shipment.id,
                  deviceId: device.id,
                  transporterOrgId: f.transporter.organizationId!,
                },
              })
            : null;
        const input: Input = {
          actor: null,
          requesterId: `device:${device.deviceCode}`,
          idempotencyKey: randomUUID(),
          operation:
            kind === 'sensor'
              ? 'INGEST_SENSOR_READING'
              : 'INGEST_SHIPMENT_TELEMETRY',
          payload: {
            deviceId: device.deviceCode,
            ...(kind === 'sensor'
              ? { cycleId: f.cycles[0].id }
              : { shipmentId: shipment.id }),
          },
        };
        const before = await positiveJournal(tx, input, { accepted: true });
        await cutover(tx, f, async () => {
          const idem = inspection(tx);
          expect(await idem.inspectCommand(input)).toMatchObject({
            status: 'COMMITTED',
            result: { accepted: true },
          });
          await tx.iotDevice.update({
            where: { id: device.id },
            data: { lastSeenAt: new Date() },
          });
          expect(
            (await tx.iotDevice.findUniqueOrThrow({ where: { id: device.id } }))
              .authorityRevision,
          ).toBe(0);
          expect((await idem.inspectCommand(input)).status).toBe('COMMITTED');
          await tx.$executeRawUnsafe('SAVEPOINT forged_device_epoch');
          let rejected = false;
          try {
            await tx.iotDevice.update({
              where: { id: device.id },
              data: { authorityRevision: 100 },
            });
          } catch (error) {
            rejected = String(error).includes(
              'Device authority revision is managed',
            );
            await tx.$executeRawUnsafe(
              'ROLLBACK TO SAVEPOINT forged_device_epoch',
            );
          }
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT forged_device_epoch');
          expect(rejected).toBe(true);
          expect(
            (await tx.iotDevice.findUniqueOrThrow({ where: { id: device.id } }))
              .authorityRevision,
          ).toBe(0);
          if (binding) {
            await tx.shipmentTrackingBinding.update({
              where: { id: binding.id },
              data: { status: 'INACTIVE', unboundAt: new Date() },
            });
            await tx.shipmentTrackingBinding.create({
              data: {
                shipmentId: shipment.id,
                deviceId: device.id,
                transporterOrgId: device.organizationId,
              },
            });
            await expect(idem.inspectCommand(input)).rejects.toBeInstanceOf(
              ConflictException,
            );
          }
          await tx.iotDevice.update({
            where: { id: device.id },
            data: { status: 'INACTIVE' },
          });
          await expect(idem.inspectCommand(input)).rejects.toBeInstanceOf(
            ForbiddenException,
          );
          await tx.iotDevice.update({
            where: { id: device.id },
            data: { status: 'ACTIVE' },
          });
          expect(
            (await tx.iotDevice.findUniqueOrThrow({ where: { id: device.id } }))
              .authorityRevision,
          ).toBe(2);
          await expect(idem.inspectCommand(input)).rejects.toBeInstanceOf(
            ConflictException,
          );
          expect(
            await tx.commandCommit.findUnique({
              where: { id: before.journal.id },
            }),
          ).toEqual(before.journal);
          expect(
            await tx.legacyCommandBridge.count({
              where: { commandCommitId: before.journal.id },
            }),
          ).toBe(1);
        });
      }),
  );

  it('reconciles cycle-bound device creation and holds a gateway request with no positive journal', () =>
    isolated(async (tx) => {
      const f = await legacyHistoryFixture(tx, trace);
      const actor = await session(tx, f.producer);
      const input: Input = {
        actor,
        requesterId: actor.sub!,
        idempotencyKey: randomUUID(),
        operation: 'CREATE_IOT_DEVICE',
        payload: {
          organizationId: actor.organizationId,
          cycleId: f.cycles[0].id,
          deviceCode: randomUUID(),
        },
      };
      const before = await positiveJournal(tx, input, { id: randomUUID() });
      const device = await tx.iotDevice.create({
        data: {
          organizationId: actor.organizationId!,
          cycleId: f.cycles[0].id,
          deviceCode: randomUUID(),
          name: 'Gateway',
          type: 'sensor',
        },
      });
      const uncertain: Input = {
        actor: null,
        requesterId: `device:${device.id}`,
        operation: 'INGEST_SENSOR_READING',
        idempotencyKey: randomUUID(),
        payload: { cycleId: f.cycles[0].id, deviceId: device.id },
      };
      const scope = await authorizeCommand(tx, uncertain, true);
      const record = await tx.idempotencyRecord.create({
        data: {
          requesterId: uncertain.requesterId,
          operation: uncertain.operation,
          requestType: 'ISOLATED_BRIDGE_FIXTURE',
          idempotencyKey: uncertain.idempotencyKey,
          requestHash: canonicalSha256(uncertain.payload),
          authorizationScope: scope,
          status: 'PROCESSING',
          createdAt: new Date(Date.now() - 60000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await cutover(tx, f, async () => {
        const idem = inspection(tx);
        expect(await idem.inspectCommand(input)).toMatchObject({
          status: 'COMMITTED',
          result: before.journal.responseBody,
        });
        expect(await idem.inspectCommand(uncertain)).toEqual({
          status: 'RECONCILIATION_REQUIRED',
        });
        expect(
          await tx.idempotencyRecord.findUnique({ where: { id: record.id } }),
        ).toEqual(record);
        expect(
          await tx.commandCommit.count({
            where: { idempotencyRecordId: record.id },
          }),
        ).toBe(0);
      });
    }));

  it('does not treat a newer scoped journal as a legacy response after the profile revision changes', () =>
    isolated(async (tx) => {
      const f = await legacyHistoryFixture(tx, trace);
      const actor = await session(tx, f.producer);
      await cutover(tx, f, async () => {
        const input: Input = {
          actor,
          requesterId: actor.sub!,
          operation: 'RECORD_CARE',
          idempotencyKey: randomUUID(),
          payload: { cycleId: f.cycles[0].id },
        };
        const before = await positiveJournal(tx, input, { id: randomUUID() });
        await tx.chainBusinessProfile.update({
          where: { chainId: f.chain.id },
          data: { state: 'SUSPENDED', version: { increment: 1 } },
        });
        await tx.chainBusinessProfile.update({
          where: { chainId: f.chain.id },
          data: { state: 'ACTIVE', version: { increment: 1 } },
        });
        await expect(
          inspection(tx).inspectCommand(input),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(
          await tx.legacyCommandBridge.count({
            where: { commandCommitId: before.journal.id },
          }),
        ).toBe(0);
      });
    }));
});
