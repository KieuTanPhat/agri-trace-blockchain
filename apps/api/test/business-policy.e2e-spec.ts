import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { newSessionIds } from './support/session.js';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { createOpenApiDocument } from '../src/common/api/openapi.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  type Prisma,
  type ScopedRole,
} from '../src/generated/prisma/client.js';
import { bindCycle, simulateFixtureLedger } from './support/chain-scope.js';
import {
  requestLedgerGrant,
  requestLedgerRevoke,
} from '../src/modules/ledger/ledger-permissions.js';
import { setBindingPaused } from '../src/modules/ledger/ledger-bindings.js';
import { confirmSimulatedPermissions } from '../src/modules/ledger/simulated-ledger.js';
import {
  authorizeCommand,
  type CommandActor,
} from '../src/common/idempotency/command-authorization.js';
import {
  authorizeBusinessCommand,
  businessRoot,
} from '../src/modules/supply-chains/business-policy.js';
import { lockChainScope } from '../src/modules/supply-chains/chain-policy.js';
import {
  scopedCycleReadWhere,
  scopedLotReadWhere,
  scopedShipmentReadWhere,
} from '../src/modules/supply-chains/business-read-scope.js';
import {
  acceptShipmentPlan,
  authorizePlanAcceptance,
  cancelShipmentPlan,
  createShipmentPlan,
  finalizeShipmentPlan,
  reviseShipmentPlan,
  shipmentPlanDigest,
} from '../src/modules/supply-chains/shipment-plan.commands.js';
import { TraceService } from '../src/modules/trace/trace.service.js';
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { privateTraceEvidenceMatches } from '../src/modules/trace/trace-evidence.js';
import { EVENT_BINDING_CONTEXT_INCLUDE } from '../src/modules/trace/ledger-route.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { commandTransaction } from '../src/common/idempotency/command-transaction.js';
import { canonicalSha256 } from '../src/common/crypto/rfc8785.js';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const serviceDb = db as unknown as PrismaService;
const trace = new TraceService(
  serviceDb,
  new OrganizationAccessService(serviceDb),
);
const idem = new IdempotencyService(serviceDb);

async function authenticated(actor: CommandActor) {
  const session = await db.refreshSession.create({
    data: { ...newSessionIds(),
      userId: actor.sub!,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { ...actor, sid: session.id };
}
let chainId: string;
let otherChainId: string;
let cycleId: string;
let lotId: string;
let shipmentId: string;
let farmId: string;
let productId: string;
let producer: CommandActor;
let transporter: CommandActor;
let retailer: CommandActor;
let reviewer: CommandActor;
let reviewAssignmentId: string;

async function grant(
  tx: Prisma.TransactionClient,
  actor: CommandActor,
  role: ScopedRole,
  chain = chainId,
) {
  const created = await tx.scopedRoleGrant.create({
    data: {
      userId: actor.sub!,
      organizationId: actor.organizationId!,
      chainId: chain,
      scope: 'CHAIN',
      role,
    },
  });
  // The API requests the ledger grant with the role grant; the simulated
  // ledger then applies it as the Worker would after a Fabric commit.
  await confirmSimulatedPermissions(tx, { guard: false });
  await requestLedgerGrant(tx, created);
  await confirmSimulatedPermissions(tx, { guard: false });
  return created;
}

async function grantWorkspaceProductionRole(
  tx: Prisma.TransactionClient,
  actor: CommandActor,
) {
  const role = await tx.enterpriseRole.create({
    data: {
      organizationId: actor.organizationId!,
      name: `CI production ${randomUUID()}`,
      permissions: ['profile.read', 'production.read', 'production.write'],
    },
  });
  await tx.enterpriseMemberRole.create({
    data: {
      userId: actor.sub!,
      organizationId: actor.organizationId!,
      roleId: role.id,
      chainIds: [chainId],
      siteIds: [farmId],
    },
  });
}

// Successful test writes roll back as well. This leaves immutable synthetic
// history intact between scenarios without bypassing any database protection.
async function isolated(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error('successful-scenario-rollback');
  try {
    await db.$transaction(
      async (tx) => {
        await run(tx);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        throw rollback;
      },
      { timeout: 20000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

const authority = (
  tx: Prisma.TransactionClient,
  actor = producer,
  role:
    | 'FARM_STAFF'
    | 'TRANSPORTER'
    | 'RETAILER'
    | 'CHAIN_MANAGER'
    | 'COMPLIANCE_REVIEWER' = 'FARM_STAFF',
  chain = chainId,
  id = cycleId,
) =>
  authorizeBusinessCommand(
    tx,
    actor,
    { chainId: chain, role, subject: { kind: 'cycle', id } },
    true,
  );

async function freshPlan(db: Prisma.TransactionClient) {
  const harvest = await db.harvestEvent.create({
    data: { cycleId, harvestTime: new Date(), quantity: '5', unit: 'kg' },
  });
  const lot = await db.lot.create({
    data: {
      lotCode: randomUUID(),
      harvestId: harvest.id,
      productId,
      farmOrgId: producer.organizationId!,
      initialQuantity: '5',
      availableQuantity: '5',
      unit: 'kg',
    },
  });
  const input = {
    transporterOrgId: transporter.organizationId!,
    retailerOrgId: retailer.organizationId!,
    quantity: '5.000',
    unit: 'kg',
    origin: 'farm',
    destination: 'shop',
  };
  return { lot, input };
}

async function acceptedPlan(db: Prisma.TransactionClient) {
  const { lot, input } = await freshPlan(db);
  const event = await trace.createInTransaction(db, {
    entityType: 'HARVEST',
    entityId: lot.harvestId!,
    cycleId,
    lotId: lot.id,
    eventType: 'HARVEST_RECORDED',
    actor: producer,
    businessData: { quantity: '5', unit: 'kg' },
  });
  await db.quantityMovement.create({
    data: {
      lotId: lot.id,
      eventId: event.id,
      type: 'HARVEST_IN',
      quantity: '5',
      unit: 'kg',
      beforeQty: '0',
      delta: '5',
      afterQty: '5',
    },
  });
  const plan = await createShipmentPlan(db, producer, chainId, lot.id, input);
  for (const [party, actor] of [
    ['PRODUCER', producer],
    ['TRANSPORTER', transporter],
    ['RETAILER', retailer],
  ] as const)
    await acceptShipmentPlan(
      db,
      actor,
      plan.id,
      party,
      0,
      plan.current.payloadDigest,
    );
  return { lot, input, plan };
}

function sqlStatements(sql: string) {
  const statements: string[] = [];
  let current = '';
  let quoted = false;
  for (const line of sql.split('\n')) {
    current += line + '\n';
    // Dollar-quoted bodies may contain ';' and span many lines.
    quoted = (line.split('$$').length - 1) % 2 ? !quoted : quoted;
    if (!quoted && line.trimEnd().endsWith(';')) {
      statements.push(current);
      current = '';
    }
  }
  return statements.filter((statement) =>
    statement.replace(/--.*$/gm, '').trim(),
  );
}

/** Runs the SQL guard scenarios in one session and returns their fixture ids. */
async function sqlScenarioFixtures() {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await client.connect();
  try {
    // Each top-level statement autocommits, as in psql: deferred guards must
    // see every scenario block as its own transaction.
    let summary;
    for (const statement of sqlStatements(
      readFileSync('test/fixtures/hybrid-scope-scenarios.sql', 'utf8'),
    ))
      summary = await client.query(statement);
    const fixtures = await client.query<{ key: string; id: string }>(
      'SELECT key, id FROM scope_fixture',
    );
    return {
      assertions: summary!.rows[0].json_build_object as { assertions: number },
      ids: Object.fromEntries(fixtures.rows.map((row) => [row.key, row.id])),
    };
  } finally {
    await client.end();
  }
}

describe('Release A scoped command policy on PostgreSQL', () => {
  let scenarios: Awaited<ReturnType<typeof sqlScenarioFixtures>>;
  beforeAll(async () => {
    scenarios = await sqlScenarioFixtures();
    await simulateFixtureLedger(db, [
      scenarios.ids.chain_a,
      scenarios.ids.chain_b,
    ]);
    const plans = await db.shipmentPlan.findMany({
      where: { id: scenarios.ids.plan },
      include: {
        current: {
          include: {
            acceptances: { include: { user: { include: { role: true } } } },
          },
        },
        lot: { include: { harvest: { include: { cycle: true } } } },
      },
    });
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    chainId = plan.chainId;
    cycleId = plan.lot.harvest!.cycleId;
    lotId = plan.lotId;
    shipmentId = plan.shipmentId!;
    farmId = plan.lot.harvest!.cycle.farmId;
    productId = plan.lot.productId;
    otherChainId = (
      await db.supplyChain.findFirstOrThrow({
        where: {
          name: 'chain_b',
          ownerOrganizationId: plan.current.producerOrgId,
        },
      })
    ).id;
    const actor = (
      party: 'PRODUCER' | 'TRANSPORTER' | 'RETAILER',
    ): CommandActor => {
      const acceptance = plan.current.acceptances.find(
        (a) => a.party === party,
      )!;
      return {
        sub: acceptance.userId,
        organizationId: acceptance.organizationId,
        role: acceptance.user.role.code,
      };
    };
    producer = actor('PRODUCER');
    transporter = actor('TRANSPORTER');
    retailer = actor('RETAILER');
    await db.$transaction(async (tx) => {
      const profile = await tx.chainBusinessProfile.findUniqueOrThrow({
        where: { chainId },
      });
      if (profile.state !== 'ACTIVE')
        await tx.chainBusinessProfile.update({
          where: { chainId },
          data: { state: 'ACTIVE', version: { increment: 1 } },
        });
      await grant(tx, producer, 'FARM_STAFF');
      await grant(tx, transporter, 'TRANSPORTER');
      await grant(tx, retailer, 'RETAILER');
      await grant(tx, producer, 'CHAIN_MANAGER');
      const role = await tx.role.upsert({
        where: { code: 'COMPLIANCE_REVIEWER' },
        update: {},
        create: { code: 'COMPLIANCE_REVIEWER', name: 'Reviewer' },
      });
      const org = await tx.organization.create({
        data: { name: `Policy reviewer ${randomUUID()}`, type: 'AUDITOR' },
      });
      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          roleId: role.id,
          email: `${randomUUID()}@example.test`,
          fullName: 'Policy reviewer',
          passwordHash: 'unused-synthetic-hash',
        },
      });
      reviewer = { sub: user.id, organizationId: org.id, role: role.code };
      for (const chain of [chainId, otherChainId])
        await tx.chainMembership.create({
          data: { chainId: chain, organizationId: org.id, status: 'ACTIVE' },
        });
      await grant(tx, reviewer, 'COMPLIANCE_REVIEWER');
      reviewAssignmentId = (
        await tx.complianceAssignment.create({
          data: { reviewerUserId: user.id, farmId },
        })
      ).id;
    });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('passes every SQL guard scenario on the real schema', () => {
    expect(scenarios.assertions.assertions).toBeGreaterThanOrEqual(24);
  });

  it('derives the same immutable chain root through cycle, Lot and Shipment', () =>
    isolated(async (tx) => {
      for (const subject of [
        { kind: 'cycle' as const, id: cycleId },
        { kind: 'lot' as const, id: lotId },
        { kind: 'shipment' as const, id: shipmentId },
      ]) {
        const root = await businessRoot(tx, subject);
        expect(root.cycle.id).toBe(cycleId);
        expect(root.cycle.chainId).toBe(chainId);
      }
    }));
  it('requires the relevant scoped grant despite a matching global role, capability and assignment', () =>
    isolated(async (tx) => {
      const g = await tx.scopedRoleGrant.findFirstOrThrow({
        where: {
          userId: producer.sub!,
          chainId,
          role: 'FARM_STAFF',
          revokedAt: null,
        },
      });
      await tx.scopedRoleGrant.update({
        where: { id: g.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      await expect(authority(tx)).rejects.toBeInstanceOf(ForbiddenException);
    }));
  it('returns the server selected stage role while preserving the authenticated actor', () =>
    isolated(async (tx) => {
      const result = await authorizeBusinessCommand(
        tx,
        transporter,
        {
          chainId,
          role: 'TRANSPORTER',
          subject: { kind: 'shipment', id: shipmentId },
        },
        true,
      );
      expect(transporter.role).toBe('FARM_STAFF');
      expect(result.actor.role).toBe('TRANSPORTER');
      expect(result.actor.sub).toBe(transporter.sub);
    }));
  it('does not let a manager act as a partner or use platform authority to write', () =>
    isolated(async (tx) => {
      await expect(
        authorizeBusinessCommand(
          tx,
          producer,
          {
            chainId,
            role: 'TRANSPORTER',
            subject: { kind: 'shipment', id: shipmentId },
          },
          true,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        authority(tx, { ...producer, role: 'SYSTEM_ADMIN' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }));
  it('rejects a forged chainId even when the user has grants in both chains', () =>
    isolated(async (tx) => {
      await grant(tx, producer, 'FARM_STAFF', otherChainId);
      await expect(
        authority(tx, producer, 'FARM_STAFF', otherChainId),
      ).rejects.toBeInstanceOf(NotFoundException);
    }));
  it('requires an ACCEPTED assignment, not membership or a proposed task', () =>
    isolated(async (tx) => {
      const cycle = await tx.productionCycle.create({
        data: {
          cycleCode: randomUUID(),
          farmId,
          farmOrgId: producer.organizationId!,
          productId,
          chainId,
        },
      });
      const assignment = await tx.stageAssignment.create({
        data: {
          chainId,
          organizationId: producer.organizationId!,
          stage: 'PRODUCTION',
          cycleId: cycle.id,
          status: 'PROPOSED',
        },
      });
      await expect(
        authority(tx, producer, 'FARM_STAFF', chainId, cycle.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await tx.stageAssignment.update({
        where: { id: assignment.id },
        data: { status: 'ACCEPTED', version: 1 },
      });
      expect(
        (await authority(tx, producer, 'FARM_STAFF', chainId, cycle.id))
          .assignment?.id,
      ).toBe(assignment.id);
    }));
  it('does not grant transport or retail authority on a cycle without the stage subject', () =>
    isolated(async (tx) => {
      await expect(
        authority(tx, transporter, 'TRANSPORTER'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(authority(tx, retailer, 'RETAILER')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }));
  it('uses the retail Lot assignment, not the user global role', () =>
    isolated(async (tx) => {
      const result = await authorizeBusinessCommand(
        tx,
        retailer,
        { chainId, role: 'RETAILER', subject: { kind: 'lot', id: lotId } },
        true,
      );
      expect(result.actor.role).toBe('RETAILER');
      expect(result.assignment).not.toBeNull();
    }));
  it('blocks suspended membership even while its old grant still exists', () =>
    isolated(async (tx) => {
      await tx.chainMembership.update({
        where: {
          chainId_organizationId: {
            chainId,
            organizationId: transporter.organizationId!,
          },
        },
        data: { status: 'SUSPENDED', version: { increment: 1 } },
      });
      await expect(
        authorizeBusinessCommand(
          tx,
          transporter,
          {
            chainId,
            role: 'TRANSPORTER',
            subject: { kind: 'shipment', id: shipmentId },
          },
          true,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }));
  it('blocks a suspended business profile', () =>
    isolated(async (tx) => {
      await tx.chainBusinessProfile.update({
        where: { chainId },
        data: { state: 'SUSPENDED', version: { increment: 1 } },
      });
      await expect(authority(tx)).rejects.toBeInstanceOf(ForbiddenException);
    }));
  it.each(['user', 'organization'] as const)('blocks inactive %s', (subject) =>
    isolated(async (tx) => {
      if (subject === 'user')
        await tx.user.update({
          where: { id: producer.sub! },
          data: { accountStatus: 'INACTIVE' },
        });
      else
        await tx.organization.update({
          where: { id: producer.organizationId! },
          data: { status: 'INACTIVE' },
        });
      await expect(authority(tx)).rejects.toBeInstanceOf(ForbiddenException);
    }),
  );
  it('blocks a revoked capability independently of the business grant', () =>
    isolated(async (tx) => {
      await tx.organizationCapability.update({
        where: {
          organizationId_code: {
            organizationId: producer.organizationId!,
            code: 'FARM',
          },
        },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      await expect(authority(tx)).rejects.toBeInstanceOf(ForbiddenException);
    }));
  it('keeps replay scope stable when an unrelated role is granted', () =>
    isolated(async (tx) => {
      const before = await authority(tx);
      await tx.organizationCapability.create({
        data: { organizationId: producer.organizationId!, code: 'RETAILER' },
      });
      await grant(tx, producer, 'RETAILER');
      expect((await authority(tx)).scope).toBe(before.scope);
    }));
  it('changes replay scope after revoke and a fresh relevant grant', () =>
    isolated(async (tx) => {
      const before = await authority(tx);
      await tx.scopedRoleGrant.update({
        where: { id: before.grant.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      // The API revokes the ledger grant together with the role grant.
      await requestLedgerRevoke(tx, before.grant.id);
      await grant(tx, producer, 'FARM_STAFF');
      expect((await authority(tx)).scope).not.toBe(before.scope);
    }));
  it('requires both chain scope and Farm assignment for a reviewer', () =>
    isolated(async (tx) => {
      expect(
        (await authority(tx, reviewer, 'COMPLIANCE_REVIEWER'))
          .reviewerAssignmentId,
      ).toBe(reviewAssignmentId);
      await grant(tx, reviewer, 'COMPLIANCE_REVIEWER', otherChainId);
      await expect(
        authority(tx, reviewer, 'COMPLIANCE_REVIEWER', otherChainId),
      ).rejects.toBeInstanceOf(NotFoundException);
      await tx.complianceAssignment.update({
        where: { id: reviewAssignmentId },
        data: { revokedAt: new Date() },
      });
      await expect(
        authority(tx, reviewer, 'COMPLIANCE_REVIEWER'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }));
  it('blocks producer self-review despite AUDITOR capability, grant and Farm assignment', () =>
    isolated(async (tx) => {
      await tx.organizationCapability.create({
        data: { organizationId: producer.organizationId!, code: 'AUDITOR' },
      });
      await grant(tx, producer, 'COMPLIANCE_REVIEWER');
      await tx.complianceAssignment.create({
        data: { reviewerUserId: producer.sub!, farmId },
      });
      await expect(
        authority(tx, producer, 'COMPLIANCE_REVIEWER'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }));

  it('serializes a real revocation behind an authorized command, then rejects replay', async () => {
    const template = await db.user.findUniqueOrThrow({
      where: { id: producer.sub! },
    });
    const user = await db.user.create({
      data: {
        organizationId: producer.organizationId,
        roleId: template.roleId,
        email: `${randomUUID()}@example.test`,
        fullName: 'Policy race',
        passwordHash: 'unused-synthetic-hash',
      },
    });
    const actor = { ...producer, sub: user.id };
    const permission = await grant(db, actor, 'FARM_STAFF');
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const command = db.$transaction(
      async (tx) => {
        const result = await authority(tx, actor);
        entered();
        await gate;
        return result.scope;
      },
      { timeout: 20000 },
    );
    const label = `hybrid-revoke-${randomUUID()}`;
    let revocation: Promise<unknown> | undefined;
    try {
      await Promise.race([
        ready,
        command.then(() => {
          throw new Error('Command ended before lock gate');
        }),
      ]);
      revocation = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('application_name', ${label}, true)`;
          await lockChainScope(tx, `org:${actor.organizationId}`);
          await lockChainScope(tx, chainId);
          await tx.scopedRoleGrant.update({
            where: { id: permission.id },
            data: { revokedAt: new Date(), revision: { increment: 1 } },
          });
        },
        { timeout: 20000 },
      );
      const deadline = Date.now() + 10000;
      let observed = false;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${label} AND wait_event_type = 'Lock') AS waiting`;
        if (rows[0].waiting) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(observed, 'PostgreSQL must report a real lock wait').toBe(true);
    } finally {
      release();
      await command;
      if (revocation) await revocation;
    }
    await expect(
      isolated(async (tx) => {
        await authority(tx, actor);
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['replay', 'inspection'] as const)(
    'locks current %s authority against revoke and never re-executes the original command',
    async (mode) => {
      const template = await db.user.findUniqueOrThrow({
        where: { id: producer.sub! },
      });
      const user = await db.user.create({
        data: {
          organizationId: producer.organizationId,
          roleId: template.roleId,
          email: `${randomUUID()}@example.test`,
          fullName: 'Replay lock scenario',
          passwordHash: 'unused-synthetic-hash',
        },
      });
      const actor = await authenticated({ ...producer, sub: user.id });
      const permission = await grant(db, actor, 'FARM_STAFF');
      const input = {
        actor,
        requesterId: actor.sub!,
        operation: 'PLANT_PRODUCTION_CYCLE',
        idempotencyKey: randomUUID(),
        requestType: 'COMMAND',
        payload: { id: cycleId, version: 0 },
      };
      const scope = await authorizeCommand(db, input);
      const record = await db.idempotencyRecord.create({
        data: {
          requesterId: actor.sub!,
          operation: input.operation,
          requestType: input.requestType,
          idempotencyKey: input.idempotencyKey,
          requestHash: canonicalSha256(input.payload),
          authorizationScope: scope,
          status: 'PROCESSING',
        },
      });
      await db.commandCommit.create({
        data: {
          idempotencyRecordId: record.id,
          requesterId: actor.sub!,
          operation: input.operation,
          authorizationScope: scope,
          actorScope: {
            organizationId: actor.organizationId,
            role: actor.role,
          },
          resourceIds: { cycleId },
          responseStatus: 201,
          responseBody: { id: cycleId },
        },
      });
      let entered!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const label = `hybrid-replay-revoke-${randomUUID()}`;
      let calls = 0;
      // Intercept only the test service's authorization transaction. Its real
      // PostgreSQL locks stay held while another connection tries to revoke.
      const replayDb = new Proxy(serviceDb, {
        get(target, key) {
          if (key === '$transaction')
            return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
              db.$transaction(
                async (tx) => {
                  const value = await work(tx);
                  entered();
                  await gate;
                  return value;
                },
                { timeout: 20000 },
              );
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const service = new IdempotencyService(replayDb);
      const replay =
        mode === 'inspection'
          ? service.inspectCommand(input)
          : service.executeCommand(input, async () => {
              calls++;
              return {};
            });
      let revoke: Promise<unknown> | undefined;
      try {
        await Promise.race([
          ready,
          replay.then(() => {
            throw new Error('Replay returned without authority lock');
          }),
        ]);
        revoke = db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT set_config('application_name', ${label}, true)`;
            await tx.scopedRoleGrant.update({
              where: { id: permission.id },
              data: { revokedAt: new Date(), revision: { increment: 1 } },
            });
          },
          { timeout: 20000 },
        );
        let observed = false;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const rows = await db.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${label} AND wait_event_type = 'Lock') AS waiting`;
          if (rows[0].waiting) {
            observed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(
          observed,
          'Replay must hold a real PostgreSQL authority lock',
        ).toBe(true);
      } finally {
        release();
        await replay;
        if (revoke) await revoke;
      }
      expect(calls).toBe(0);
      if (mode === 'inspection')
        await expect(idem.inspectCommand(input)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      await expect(
        idem.executeCommand(input, async () => {
          calls++;
          return {};
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(calls).toBe(0);
    },
  );

  it('filters list, direct ID and count across chains that share a Farm', () =>
    isolated(async (tx) => {
      const other = await tx.productionCycle.create({
        data: {
          cycleCode: randomUUID(),
          productId,
          farmId,
          farmOrgId: producer.organizationId!,
          chainId: otherChainId,
        },
      });
      await tx.stageAssignment.create({
        data: {
          chainId: otherChainId,
          organizationId: producer.organizationId!,
          stage: 'PRODUCTION',
          cycleId: other.id,
          status: 'ACCEPTED',
        },
      });
      for (const actor of [producer, reviewer]) {
        const where = scopedCycleReadWhere(actor);
        const rows = await tx.productionCycle.findMany({
          where,
          select: { id: true },
        });
        expect(rows.map((row) => row.id)).toEqual([cycleId]);
        expect(
          await tx.productionCycle.findFirst({
            where: { AND: [where, { id: other.id }] },
          }),
        ).toBeNull();
        expect(
          await tx.productionCycle.count({
            where: { AND: [where, { chainId: otherChainId }] },
          }),
        ).toBe(0);
      }
    }));

  it('filters sibling Lots independently even when a parent cycle is visible', () =>
    isolated(async (tx) => {
      const harvest = await tx.harvestEvent.create({
        data: { cycleId, harvestTime: new Date(), quantity: '2', unit: 'kg' },
      });
      const sibling = await tx.lot.create({
        data: {
          lotCode: randomUUID(),
          harvestId: harvest.id,
          productId,
          farmOrgId: producer.organizationId!,
          initialQuantity: '2',
          availableQuantity: '2',
          unit: 'kg',
        },
      });
      for (const actor of [transporter, retailer]) {
        const cycle = await tx.productionCycle.findFirstOrThrow({
          where: { AND: [scopedCycleReadWhere(actor), { id: cycleId }] },
          include: {
            harvestEvents: {
              where: { lot: { is: scopedLotReadWhere(actor) } },
              include: { lot: true },
            },
          },
        });
        expect(cycle.harvestEvents.map((h) => h.lot!.id)).toEqual([lotId]);
        expect(
          await tx.lot.findFirst({
            where: { AND: [scopedLotReadWhere(actor), { id: sibling.id }] },
          }),
        ).toBeNull();
        expect(await tx.lot.count({ where: scopedLotReadWhere(actor) })).toBe(
          1,
        );
        expect(
          await tx.shipment.count({ where: scopedShipmentReadWhere(actor) }),
        ).toBe(1);
      }
    }));

  it('does not expose raw business records through owner, org admin or global admin authority', () =>
    isolated(async (tx) => {
      const template = await tx.user.findUniqueOrThrow({
        where: { id: producer.sub! },
      });
      const user = await tx.user.create({
        data: {
          organizationId: producer.organizationId,
          roleId: template.roleId,
          email: `${randomUUID()}@example.test`,
          fullName: 'Manager only',
          passwordHash: 'unused-synthetic-hash',
        },
      });
      const manager = { ...producer, sub: user.id };
      await grant(tx, manager, 'CHAIN_MANAGER');
      await tx.scopedRoleGrant.create({
        data: {
          userId: user.id,
          organizationId: producer.organizationId!,
          scope: 'ORGANIZATION',
          role: 'ORG_ADMIN',
        },
      });
      for (const actor of [manager, { ...producer, role: 'SYSTEM_ADMIN' }]) {
        expect(
          await tx.productionCycle.count({
            where: scopedCycleReadWhere(actor),
          }),
        ).toBe(0);
        expect(await tx.lot.count({ where: scopedLotReadWhere(actor) })).toBe(
          0,
        );
        expect(
          await tx.shipment.count({ where: scopedShipmentReadWhere(actor) }),
        ).toBe(0);
      }
    }));

  it('removes read visibility immediately when the relevant grant is revoked', () =>
    isolated(async (tx) => {
      expect(
        await tx.lot.count({ where: scopedLotReadWhere(transporter) }),
      ).toBe(1);
      const g = await tx.scopedRoleGrant.findFirstOrThrow({
        where: {
          userId: transporter.sub!,
          chainId,
          role: 'TRANSPORTER',
          revokedAt: null,
        },
      });
      await tx.scopedRoleGrant.update({
        where: { id: g.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      expect(
        await tx.lot.count({ where: scopedLotReadWhere(transporter) }),
      ).toBe(0);
      expect(
        await tx.productionCycle.count({
          where: scopedCycleReadWhere(transporter),
        }),
      ).toBe(0);
    }));

  it('removes read visibility when membership or profile is suspended', () =>
    isolated(async (tx) => {
      await tx.chainMembership.update({
        where: {
          chainId_organizationId: {
            chainId,
            organizationId: transporter.organizationId!,
          },
        },
        data: { status: 'SUSPENDED', version: { increment: 1 } },
      });
      expect(
        await tx.lot.count({ where: scopedLotReadWhere(transporter) }),
      ).toBe(0);
      expect(await tx.lot.count({ where: scopedLotReadWhere(retailer) })).toBe(
        1,
      );
      await tx.chainBusinessProfile.update({
        where: { chainId },
        data: { state: 'SUSPENDED', version: { increment: 1 } },
      });
      expect(await tx.lot.count({ where: scopedLotReadWhere(retailer) })).toBe(
        0,
      );
    }));

  it('creates an immutable draft revision without reserving stock or creating a Shipment', () =>
    isolated(async (tx) => {
      const { lot, input } = await freshPlan(tx);
      // Scope the count: other E2E files write events concurrently.
      const beforeEvents = await tx.traceEvent.count({
        where: { cycleId },
      });
      const plan = await createShipmentPlan(
        tx,
        producer,
        chainId,
        lot.id,
        input,
      );
      expect(plan.currentRevision).toBe(0);
      expect(plan.current.payloadDigest).toBe(
        shipmentPlanDigest(chainId, lot.id, 0, plan.current),
      );
      expect(plan.current.quantity.toFixed(3)).toBe('5.000');
      expect(
        (
          await tx.lot.findUniqueOrThrow({ where: { id: lot.id } })
        ).availableQuantity.toFixed(3),
      ).toBe('5.000');
      expect(await tx.shipment.count({ where: { lotId: lot.id } })).toBe(0);
      expect(await tx.traceEvent.count({ where: { cycleId } })).toBe(
        beforeEvents,
      );
      expect(
        await tx.chainAudit.count({
          where: { subjectId: plan.id, operation: 'CREATE_SHIPMENT_PLAN' },
        }),
      ).toBe(1);
    }));

  it('rejects partner proposal and incorrect quantity without a partial plan or audit', () =>
    isolated(async (tx) => {
      const { lot, input } = await freshPlan(tx);
      const before = await tx.chainAudit.count();
      await expect(
        createShipmentPlan(tx, transporter, chainId, lot.id, input),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        createShipmentPlan(tx, producer, chainId, lot.id, {
          ...input,
          quantity: '4',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await tx.shipmentPlan.count({ where: { lotId: lot.id } })).toBe(0);
      expect(await tx.chainAudit.count()).toBe(before);
    }));

  it('requires each organization to accept its own party and exact immutable payload', () =>
    isolated(async (tx) => {
      const { lot, input } = await freshPlan(tx);
      const plan = await createShipmentPlan(
        tx,
        producer,
        chainId,
        lot.id,
        input,
      );
      await expect(
        acceptShipmentPlan(
          tx,
          producer,
          plan.id,
          'TRANSPORTER',
          0,
          plan.current.payloadDigest,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        acceptShipmentPlan(
          tx,
          transporter,
          plan.id,
          'TRANSPORTER',
          0,
          'f'.repeat(64),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      for (const [party, actor] of [
        ['PRODUCER', producer],
        ['TRANSPORTER', transporter],
        ['RETAILER', retailer],
      ] as const) {
        const before = await authorizePlanAcceptance(
          tx,
          actor,
          plan.id,
          party,
          0,
          plan.current.payloadDigest,
        );
        const accepted = await acceptShipmentPlan(
          tx,
          actor,
          plan.id,
          party,
          0,
          plan.current.payloadDigest,
        );
        expect(accepted.userId).toBe(actor.sub);
        expect(accepted.organizationId).toBe(actor.organizationId);
        expect(
          (
            await authorizePlanAcceptance(
              tx,
              actor,
              plan.id,
              party,
              0,
              plan.current.payloadDigest,
            )
          ).scope,
        ).toBe(before.scope);
      }
      expect(
        await tx.shipmentPlanAcceptance.count({ where: { planId: plan.id } }),
      ).toBe(3);
      await expect(
        acceptShipmentPlan(
          tx,
          producer,
          plan.id,
          'PRODUCER',
          0,
          plan.current.payloadDigest,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    }));

  it('retains old consent and requires new consent after revision, with stale version protection', async () => {
    const { plan, input } = await db.$transaction(
      async (tx) => {
        const { lot, input } = await freshPlan(tx);
        const plan = await createShipmentPlan(
          tx,
          producer,
          chainId,
          lot.id,
          input,
        );
        return { plan, input };
      },
      { timeout: 20000 },
    );
    const old = await db.$transaction(
      (tx) =>
        acceptShipmentPlan(
          tx,
          producer,
          plan.id,
          'PRODUCER',
          0,
          plan.current.payloadDigest,
        ),
      { timeout: 20000 },
    );
    const next = await db.$transaction(
      (tx) =>
        reviseShipmentPlan(tx, producer, plan.id, 0, {
          ...input,
          destination: 'new-shop',
        }),
      { timeout: 20000 },
    );
    expect(next.version).toBe(1);
    expect(next.currentRevision).toBe(1);
    expect(next.current.payloadDigest).not.toBe(plan.current.payloadDigest);
    expect(
      await db.shipmentPlanAcceptance.findUnique({ where: { id: old.id } }),
    ).not.toBeNull();
    await expect(
      db.$transaction(
        (tx) =>
          acceptShipmentPlan(
            tx,
            producer,
            plan.id,
            'PRODUCER',
            0,
            plan.current.payloadDigest,
          ),
        { timeout: 20000 },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      db.$transaction(
        (tx) => reviseShipmentPlan(tx, producer, plan.id, 0, input),
        { timeout: 20000 },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await db.$transaction(
      (tx) =>
        acceptShipmentPlan(
          tx,
          producer,
          plan.id,
          'PRODUCER',
          1,
          next.current.payloadDigest,
        ),
      { timeout: 20000 },
    );
    expect(
      await db.shipmentPlanRevision.count({ where: { planId: plan.id } }),
    ).toBe(2);
    expect(
      await db.shipmentPlanAcceptance.count({ where: { planId: plan.id } }),
    ).toBe(2);
  });

  it('does not authorize consent through an old revoked org admin grant', () =>
    isolated(async (tx) => {
      const { lot, input } = await freshPlan(tx);
      const plan = await createShipmentPlan(
        tx,
        producer,
        chainId,
        lot.id,
        input,
      );
      const before = await authorizePlanAcceptance(
        tx,
        producer,
        plan.id,
        'PRODUCER',
        0,
        plan.current.payloadDigest,
      );
      const consent = await acceptShipmentPlan(
        tx,
        producer,
        plan.id,
        'PRODUCER',
        0,
        plan.current.payloadDigest,
      );
      await tx.scopedRoleGrant.update({
        where: { id: before.grant.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      await expect(
        authorizePlanAcceptance(
          tx,
          producer,
          plan.id,
          'PRODUCER',
          0,
          plan.current.payloadDigest,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const replacement = await tx.scopedRoleGrant.create({
        data: {
          userId: producer.sub!,
          organizationId: producer.organizationId!,
          scope: 'ORGANIZATION',
          role: 'ORG_ADMIN',
        },
      });
      expect(
        (
          await authorizePlanAcceptance(
            tx,
            producer,
            plan.id,
            'PRODUCER',
            0,
            plan.current.payloadDigest,
          )
        ).scope,
      ).not.toBe(before.scope);
      expect(
        (
          await tx.shipmentPlanAcceptance.findUniqueOrThrow({
            where: { id: consent.id },
          })
        ).grantId,
      ).not.toBe(replacement.id);
    }));

  it('cancels a draft while retaining revision and acceptance history', () =>
    isolated(async (tx) => {
      const { lot, input } = await freshPlan(tx);
      const plan = await createShipmentPlan(
        tx,
        producer,
        chainId,
        lot.id,
        input,
      );
      await acceptShipmentPlan(
        tx,
        producer,
        plan.id,
        'PRODUCER',
        0,
        plan.current.payloadDigest,
      );
      expect((await cancelShipmentPlan(tx, producer, plan.id, 0)).status).toBe(
        'CANCELLED',
      );
      expect(
        await tx.shipmentPlanRevision.count({ where: { planId: plan.id } }),
      ).toBe(1);
      expect(
        await tx.shipmentPlanAcceptance.count({ where: { planId: plan.id } }),
      ).toBe(1);
      await expect(
        reviseShipmentPlan(tx, producer, plan.id, 1, input),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        acceptShipmentPlan(
          tx,
          retailer,
          plan.id,
          'RETAILER',
          0,
          plan.current.payloadDigest,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await tx.shipment.count({ where: { lotId: lot.id } })).toBe(0);
    }));

  it('finalizes Shipment, both assignments, trace, outbox and context with the actual manager actor', () =>
    isolated(async (tx) => {
      const { lot, plan } = await acceptedPlan(tx);
      const result = await finalizeShipmentPlan(
        tx,
        producer,
        plan.id,
        0,
        trace,
      );
      const event = await tx.traceEvent.findUniqueOrThrow({
        where: { id: result.eventId },
        include: { bindingContext: EVENT_BINDING_CONTEXT_INCLUDE },
      });
      expect(event.actorUserId).toBe(producer.sub);
      expect(event.actorRole).toBe('CHAIN_MANAGER');
      expect(privateTraceEvidenceMatches(event)).toBe(true);
      expect(event.businessData).toMatchObject({
        chainId,
        shipmentPlanId: plan.id,
        payloadDigest: plan.current.payloadDigest,
      });
      expect(
        await tx.blockchainOutbox.count({
          where: { eventId: result.eventId, status: 'PENDING' },
        }),
      ).toBe(1);
      expect(
        await tx.eventChainContext.count({
          where: { eventId: result.eventId, chainId },
        }),
      ).toBe(1);
      expect(
        await tx.stageAssignment.count({
          where: {
            chainId,
            shipmentId: result.shipment.id,
            stage: 'TRANSPORT',
            status: 'ACCEPTED',
          },
        }),
      ).toBe(1);
      expect(
        await tx.stageAssignment.count({
          where: {
            chainId,
            lotId: lot.id,
            stage: 'RETAIL',
            status: 'ACCEPTED',
          },
        }),
      ).toBe(1);
      expect(
        (await tx.shipmentPlan.findUniqueOrThrow({ where: { id: plan.id } }))
          .status,
      ).toBe('FINALIZED');
      expect(
        (
          await tx.lot.findUniqueOrThrow({ where: { id: lot.id } })
        ).availableQuantity.toFixed(3),
      ).toBe('5.000');
    }));

  it('requires all three current confirmations before creating any physical resource', () =>
    isolated(async (tx) => {
      const { lot, input } = await freshPlan(tx);
      const plan = await createShipmentPlan(
        tx,
        producer,
        chainId,
        lot.id,
        input,
      );
      await acceptShipmentPlan(
        tx,
        producer,
        plan.id,
        'PRODUCER',
        0,
        plan.current.payloadDigest,
      );
      await expect(
        finalizeShipmentPlan(tx, producer, plan.id, 0, trace),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await tx.shipment.count({ where: { lotId: lot.id } })).toBe(0);
      expect(await tx.stageAssignment.count({ where: { lotId: lot.id } })).toBe(
        0,
      );
    }));

  it('does not revive old finalize consent by granting a fresh org admin role', () =>
    isolated(async (tx) => {
      const { lot, plan } = await acceptedPlan(tx);
      const acceptance = await tx.shipmentPlanAcceptance.findUniqueOrThrow({
        where: {
          planId_revision_party: {
            planId: plan.id,
            revision: 0,
            party: 'TRANSPORTER',
          },
        },
      });
      await tx.scopedRoleGrant.update({
        where: { id: acceptance.grantId },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      await tx.scopedRoleGrant.create({
        data: {
          userId: transporter.sub!,
          organizationId: transporter.organizationId!,
          scope: 'ORGANIZATION',
          role: 'ORG_ADMIN',
        },
      });
      await expect(
        finalizeShipmentPlan(tx, producer, plan.id, 0, trace),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await tx.shipment.count({ where: { lotId: lot.id } })).toBe(0);
    }));

  /** Committed epoch scenario: the old consent is rejected and kept intact;
   * a new revision with fresh consent from every party finalizes. */
  async function staleConsentNeedsNewRevision(
    change: (tx: Prisma.TransactionClient) => Promise<void>,
    accept: (
      tx: Prisma.TransactionClient,
      plan: { id: string; current: { payloadDigest: string } },
    ) => Promise<void> = async (tx, plan) => {
      for (const [party, actor] of [
        ['PRODUCER', producer],
        ['TRANSPORTER', transporter],
        ['RETAILER', retailer],
      ] as const)
        await acceptShipmentPlan(
          tx,
          actor,
          plan.id,
          party,
          0,
          plan.current.payloadDigest,
        );
    },
  ) {
    const { lot, input, plan } = await db.$transaction(
      async (tx) => {
        const fresh = await freshPlan(tx);
        const event = await trace.createInTransaction(tx, {
          entityType: 'HARVEST',
          entityId: fresh.lot.harvestId!,
          cycleId,
          lotId: fresh.lot.id,
          eventType: 'HARVEST_RECORDED',
          actor: producer,
          businessData: { quantity: '5', unit: 'kg' },
        });
        await tx.quantityMovement.create({
          data: {
            lotId: fresh.lot.id,
            eventId: event.id,
            type: 'HARVEST_IN',
            quantity: '5',
            unit: 'kg',
            beforeQty: '0',
            delta: '5',
            afterQty: '5',
          },
        });
        const created = await createShipmentPlan(
          tx,
          producer,
          chainId,
          fresh.lot.id,
          fresh.input,
        );
        await accept(tx, created);
        return { ...fresh, plan: created };
      },
      { timeout: 20000 },
    );
    const before = await db.shipmentPlanAcceptance.findMany({
      where: { planId: plan.id },
      orderBy: { party: 'asc' },
    });
    await db.$transaction(change, { timeout: 20000 });
    await expect(
      db.$transaction(
        (tx) => finalizeShipmentPlan(tx, producer, plan.id, 0, trace),
        { timeout: 20000 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await db.shipment.count({ where: { lotId: lot.id } })).toBe(0);
    expect(
      await db.shipmentPlanAcceptance.findMany({
        where: { planId: plan.id },
        orderBy: { party: 'asc' },
      }),
    ).toEqual(before);
    const result = await db.$transaction(
      async (tx) => {
        const next = await reviseShipmentPlan(tx, producer, plan.id, 0, input);
        for (const [party, actor] of [
          ['PRODUCER', producer],
          ['TRANSPORTER', transporter],
          ['RETAILER', retailer],
        ] as const)
          await acceptShipmentPlan(
            tx,
            actor,
            plan.id,
            party,
            1,
            next.current.payloadDigest,
          );
        return finalizeShipmentPlan(tx, producer, plan.id, 1, trace);
      },
      { timeout: 20000 },
    );
    expect(result.revision).toBe(1);
    return before;
  }

  for (const leave of ['SUSPENDED', 'REVOKED'] as const)
    it(`does not revive consent after ${leave} membership rejoins under the same org admin grant`, async () => {
      const where = {
        chainId_organizationId: {
          chainId,
          organizationId: transporter.organizationId!,
        },
      };
      const before = await staleConsentNeedsNewRevision(async (tx) => {
        await tx.chainMembership.update({
          where,
          data: { status: leave, version: { increment: 1 } },
        });
        await tx.chainMembership.update({
          where,
          data: {
            status: 'INVITED',
            version: { increment: 1 },
            invitationRevision: { increment: 1 },
          },
        });
        await tx.chainMembership.update({
          where,
          data: { status: 'ACTIVE', version: { increment: 1 } },
        });
      });
      const consent = before.find((a) => a.party === 'TRANSPORTER')!;
      expect(consent.membershipVersion).toBe(
        (await db.chainMembership.findUniqueOrThrow({ where })).version - 3,
      );
      // The ORGANIZATION-scope ORG_ADMIN grant is untouched by rejoin.
      expect(
        (
          await db.scopedRoleGrant.findUniqueOrThrow({
            where: { id: consent.grantId },
          })
        ).revision,
      ).toBe(consent.grantRevision);
    });

  it('does not revive consent after the party capability is revoked and regranted', async () => {
    const where = {
      organizationId_code: {
        organizationId: retailer.organizationId!,
        code: 'RETAILER' as const,
      },
    };
    const before = await staleConsentNeedsNewRevision(async (tx) => {
      await tx.organizationCapability.update({
        where,
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      await tx.organizationCapability.update({
        where,
        data: { revokedAt: null, revision: { increment: 1 } },
      });
    });
    expect(before.find((a) => a.party === 'RETAILER')!.capabilityRevision).toBe(
      (await db.organizationCapability.findUniqueOrThrow({ where })).revision -
        2,
    );
  });

  it('rolls back physical writes when trace/outbox creation fails', async () => {
    const { lot, plan } = await db.$transaction((tx) => acceptedPlan(tx), {
      timeout: 20000,
    });
    const beforeEvents = await db.traceEvent.count({
      where: { lotId: lot.id },
    });
    const beforeOutbox = await db.blockchainOutbox.count({
      where: { traceEvent: { lotId: lot.id } },
    });
    await expect(
      db.$transaction(
        (tx) =>
          finalizeShipmentPlan(tx, producer, plan.id, 0, {
            createInTransaction: async () => {
              throw new Error('injected-trace-failure');
            },
          }),
        { timeout: 20000 },
      ),
    ).rejects.toThrow('injected-trace-failure');
    expect(await db.shipment.count({ where: { lotId: lot.id } })).toBe(0);
    expect(
      await db.stageAssignment.count({
        where: { OR: [{ lotId: lot.id }, { shipment: { lotId: lot.id } }] },
      }),
    ).toBe(0);
    expect(
      (await db.shipmentPlan.findUniqueOrThrow({ where: { id: plan.id } }))
        .status,
    ).toBe('DRAFT');
    expect(await db.traceEvent.count({ where: { lotId: lot.id } })).toBe(
      beforeEvents,
    );
    expect(
      await db.blockchainOutbox.count({
        where: { traceEvent: { lotId: lot.id } },
      }),
    ).toBe(beforeOutbox);
  });

  it('allows only one of two concurrent plans to finalize the same Lot', async () => {
    const { lot, first, second } = await db.$transaction(
      async (tx) => {
        const { lot, plan: first, input } = await acceptedPlan(tx);
        const second = await createShipmentPlan(tx, producer, chainId, lot.id, {
          ...input,
          destination: 'other-shop',
        });
        for (const [party, actor] of [
          ['PRODUCER', producer],
          ['TRANSPORTER', transporter],
          ['RETAILER', retailer],
        ] as const)
          await acceptShipmentPlan(
            tx,
            actor,
            second.id,
            party,
            0,
            second.current.payloadDigest,
          );
        return { lot, first, second };
      },
      { timeout: 20000 },
    );
    const results = await Promise.allSettled(
      [first, second].map((plan) =>
        db.$transaction(
          (tx) => finalizeShipmentPlan(tx, producer, plan.id, 0, trace),
          { timeout: 20000 },
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConflictException);
    expect(await db.shipment.count({ where: { lotId: lot.id } })).toBe(1);
    expect(
      await db.shipmentPlan.count({
        where: { lotId: lot.id, status: 'FINALIZED' },
      }),
    ).toBe(1);
    expect(
      await db.traceEvent.count({
        where: { lotId: lot.id, eventType: 'SHIPMENT_CREATED' },
      }),
    ).toBe(1);
    expect(
      await db.blockchainOutbox.count({
        where: { traceEvent: { lotId: lot.id, eventType: 'SHIPMENT_CREATED' } },
      }),
    ).toBe(1);
    expect(
      await db.stageAssignment.count({
        where: { OR: [{ lotId: lot.id }, { shipment: { lotId: lot.id } }] },
      }),
    ).toBe(2);
  });

  it('accepts three distinct party confirmations for one multi-capability enterprise, marking handover internal', () =>
    isolated(async (tx) => {
      for (const code of ['TRANSPORTER', 'RETAILER'] as const) {
        await tx.organizationCapability.create({
          data: { organizationId: producer.organizationId!, code },
        });
        await grant(tx, producer, code);
      }
      const { lot, input } = await freshPlan(tx);
      const harvest = await trace.createInTransaction(tx, {
        entityType: 'HARVEST',
        entityId: lot.harvestId!,
        cycleId,
        lotId: lot.id,
        eventType: 'HARVEST_RECORDED',
        actor: producer,
        businessData: { quantity: '5', unit: 'kg' },
      });
      await tx.quantityMovement.create({
        data: {
          lotId: lot.id,
          eventId: harvest.id,
          type: 'HARVEST_IN',
          quantity: '5',
          unit: 'kg',
          beforeQty: '0',
          delta: '5',
          afterQty: '5',
        },
      });
      const plan = await createShipmentPlan(tx, producer, chainId, lot.id, {
        ...input,
        transporterOrgId: producer.organizationId!,
        retailerOrgId: producer.organizationId!,
      });
      for (const party of ['PRODUCER', 'TRANSPORTER', 'RETAILER'] as const)
        await acceptShipmentPlan(
          tx,
          producer,
          plan.id,
          party,
          0,
          plan.current.payloadDigest,
        );
      const result = await finalizeShipmentPlan(
        tx,
        producer,
        plan.id,
        0,
        trace,
      );
      expect(
        (
          await tx.traceEvent.findUniqueOrThrow({
            where: { id: result.eventId },
          })
        ).businessData,
      ).toMatchObject({
        handover: {
          producerToTransporter: 'INTERNAL',
          transporterToRetailer: 'INTERNAL',
        },
      });
      expect(
        (
          await tx.organization.findUniqueOrThrow({
            where: { id: producer.organizationId! },
          })
        ).type,
      ).toBe('FARM');
      for (const role of ['TRANSPORTER', 'RETAILER'] as const) {
        const effective = await authorizeBusinessCommand(
          tx,
          producer,
          {
            chainId,
            role,
            subject: { kind: 'shipment', id: result.shipment.id },
          },
          true,
        );
        expect(effective.actor.role).toBe(role);
        expect(effective.assignment).not.toBeNull();
      }
    }));

  it('allows Farm ownership through FARM capability without changing primary organization type', () =>
    isolated(async (tx) => {
      await tx.organizationCapability.create({
        data: { organizationId: transporter.organizationId!, code: 'FARM' },
      });
      const farm = await tx.farm.create({
        data: {
          organizationId: transporter.organizationId!,
          name: 'Capability farm',
        },
      });
      expect(farm.organizationId).toBe(transporter.organizationId);
      expect(
        (
          await tx.organization.findUniqueOrThrow({
            where: { id: transporter.organizationId! },
          })
        ).type,
      ).toBe('TRANSPORTER');
    }));

  it('rejects Farm ownership without current FARM capability at the database guard', async () => {
    await expect(
      db.$transaction((tx) =>
        tx.farm.create({
          data: {
            organizationId: transporter.organizationId!,
            name: 'Forbidden capability farm',
          },
        }),
      ),
    ).rejects.toThrow('requires active FARM capability');
  });

  it('replays draft creation without duplicates and commits its result journal with the plan', async () => {
    const actor = await authenticated(producer);
    const { lot, input } = await db.$transaction((tx) => freshPlan(tx), {
      timeout: 20000,
    });
    const command = {
      actor,
      requesterId: actor.sub!,
      operation: 'SCOPE_CREATE_SHIPMENT_PLAN',
      idempotencyKey: randomUUID(),
      requestType: 'COMMAND',
      responseStatus: 201,
      payload: { chainId, lotId: lot.id, ...input },
    };
    let calls = 0;
    const run = () => {
      calls++;
      return commandTransaction(
        serviceDb,
        (tx) => createShipmentPlan(tx, actor, chainId, lot.id, input),
        { timeout: 20000 },
      );
    };
    const first = await idem.executeCommand(command, run);
    const replay = await idem.executeCommand(command, run);
    expect(calls).toBe(1);
    expect(JSON.parse(JSON.stringify(replay))).toEqual(
      JSON.parse(JSON.stringify(first)),
    );
    expect(await db.shipmentPlan.count({ where: { lotId: lot.id } })).toBe(1);
    const record = await db.idempotencyRecord.findUniqueOrThrow({
      where: {
        requesterId_operation_idempotencyKey: {
          requesterId: actor.sub!,
          operation: command.operation,
          idempotencyKey: command.idempotencyKey,
        },
      },
    });
    expect(record.status).toBe('COMPLETED');
    expect(
      await db.commandCommit.count({
        where: { idempotencyRecordId: record.id },
      }),
    ).toBe(1);
    await expect(
      idem.executeCommand(
        { ...command, payload: { ...command.payload, chainId: otherChainId } },
        run,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toBe(1);
  });

  it('replays party consent after finalization without requiring the old DRAFT lifecycle state', async () => {
    const { plan } = await db.$transaction((tx) => acceptedPlan(tx), {
      timeout: 20000,
    });
    // This plan already has producer consent from setup. A fresh command must
    // report a conflict, not adopt an acceptance created outside its journal.
    const actor = await authenticated(producer);
    const command = {
      actor,
      requesterId: actor.sub!,
      operation: 'SCOPE_ACCEPT_SHIPMENT_PLAN',
      idempotencyKey: randomUUID(),
      requestType: 'COMMAND',
      responseStatus: 201,
      payload: {
        chainId,
        planId: plan.id,
        party: 'PRODUCER',
        revision: 0,
        payloadDigest: plan.current.payloadDigest,
      },
    };
    await expect(
      idem.executeCommand(command, () =>
        commandTransaction(
          serviceDb,
          (tx) =>
            acceptShipmentPlan(
              tx,
              actor,
              plan.id,
              'PRODUCER',
              0,
              plan.current.payloadDigest,
            ),
          { timeout: 20000 },
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const { lot, input } = await db.$transaction((tx) => freshPlan(tx), {
      timeout: 20000,
    });
    const fresh = await db.$transaction(
      (tx) => createShipmentPlan(tx, producer, chainId, lot.id, input),
      { timeout: 20000 },
    );
    const consentCommand = {
      ...command,
      idempotencyKey: randomUUID(),
      payload: {
        ...command.payload,
        planId: fresh.id,
        payloadDigest: fresh.current.payloadDigest,
      },
    };
    let calls = 0;
    const run = () => {
      calls++;
      return commandTransaction(
        serviceDb,
        (tx) =>
          acceptShipmentPlan(
            tx,
            actor,
            fresh.id,
            'PRODUCER',
            0,
            fresh.current.payloadDigest,
          ),
        { timeout: 20000 },
      );
    };
    const first = await idem.executeCommand(consentCommand, run);
    for (const [party, participant] of [
      ['TRANSPORTER', transporter],
      ['RETAILER', retailer],
    ] as const)
      await db.$transaction(
        (tx) =>
          acceptShipmentPlan(
            tx,
            participant,
            fresh.id,
            party,
            0,
            fresh.current.payloadDigest,
          ),
        { timeout: 20000 },
      );
    const event = await db.$transaction(
      async (tx) => {
        const event = await trace.createInTransaction(tx, {
          entityType: 'HARVEST',
          entityId: lot.harvestId!,
          cycleId,
          lotId: lot.id,
          eventType: 'HARVEST_RECORDED',
          actor: producer,
          businessData: { quantity: '5', unit: 'kg' },
        });
        await tx.quantityMovement.create({
          data: {
            lotId: lot.id,
            eventId: event.id,
            type: 'HARVEST_IN',
            quantity: '5',
            unit: 'kg',
            beforeQty: '0',
            delta: '5',
            afterQty: '5',
          },
        });
        return finalizeShipmentPlan(tx, producer, fresh.id, 0, trace);
      },
      { timeout: 20000 },
    );
    expect(event.planId).toBe(fresh.id);
    expect(
      JSON.parse(
        JSON.stringify(await idem.executeCommand(consentCommand, run)),
      ),
    ).toEqual(JSON.parse(JSON.stringify(first)));
    expect(calls).toBe(1);
  });

  it('replays finalize without another Shipment/event and rejects replay when a confirming grant is revoked', async () => {
    const { lot, plan } = await db.$transaction((tx) => acceptedPlan(tx), {
      timeout: 20000,
    });
    const actor = await authenticated(producer);
    const command = {
      actor,
      requesterId: actor.sub!,
      operation: 'SCOPE_FINALIZE_SHIPMENT_PLAN',
      idempotencyKey: randomUUID(),
      requestType: 'COMMAND',
      responseStatus: 201,
      payload: { chainId, planId: plan.id, version: 0 },
    };
    let calls = 0;
    const run = () => {
      calls++;
      return commandTransaction(
        serviceDb,
        (tx) => finalizeShipmentPlan(tx, actor, plan.id, 0, trace),
        { timeout: 20000 },
      );
    };
    const first = await idem.executeCommand(command, run);
    expect(
      JSON.parse(JSON.stringify(await idem.executeCommand(command, run))),
    ).toEqual(JSON.parse(JSON.stringify(first)));
    expect(calls).toBe(1);
    expect(await db.shipment.count({ where: { lotId: lot.id } })).toBe(1);
    expect(
      await db.traceEvent.count({
        where: { lotId: lot.id, eventType: 'SHIPMENT_CREATED' },
      }),
    ).toBe(1);
    const consent = await db.shipmentPlanAcceptance.findUniqueOrThrow({
      where: {
        planId_revision_party: {
          planId: plan.id,
          revision: 0,
          party: 'TRANSPORTER',
        },
      },
    });
    // Restore authority with a new grant for later scenarios; the old consent
    // must remain invalid because it retains the original grant identity.
    await db.scopedRoleGrant.update({
      where: { id: consent.grantId },
      data: { revokedAt: new Date(), revision: { increment: 1 } },
    });
    await db.scopedRoleGrant.create({
      data: {
        userId: transporter.sub!,
        organizationId: transporter.organizationId!,
        scope: 'ORGANIZATION',
        role: 'ORG_ADMIN',
      },
    });
    await expect(idem.executeCommand(command, run)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(calls).toBe(1);
  });

  describe('HTTP scope and command contracts', () => {
    let app: INestApplication;
    let producerToken: string;
    let transporterToken: string;
    let retailerToken: string;
    beforeAll(async () => {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(serviceDb)
        .overrideProvider(ConfigService)
        .useValue(
          new ConfigService({
            ...process.env,
            JWT_SECRET: 'isolated-hybrid-http-only',
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
      const token = async (actor: CommandActor) => {
        const active = await authenticated(actor);
        return app.get(JwtService).sign({ sub: actor.sub, sid: active.sid });
      };
      producerToken = await token(producer);
      transporterToken = await token(transporter);
      retailerToken = await token(retailer);
    });
    afterAll(async () => {
      if (app) await app.close();
    });
    const post = (
      url: string,
      token: string,
      body: object,
      key: string = randomUUID(),
    ) =>
      request(app.getHttpServer())
        .post(`/api${url}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send(body);
    const get = (url: string, token: string) =>
      request(app.getHttpServer())
        .get(`/api${url}`)
        .set('Authorization', `Bearer ${token}`);

    async function preparingChain() {
      if (
        !(await db.scopedRoleGrant.findFirst({
          where: {
            userId: producer.sub!,
            organizationId: producer.organizationId!,
            scope: 'ORGANIZATION',
            role: 'CREATE_CHAIN',
            revokedAt: null,
          },
        }))
      )
        await db.scopedRoleGrant.create({
          data: {
            userId: producer.sub!,
            organizationId: producer.organizationId!,
            scope: 'ORGANIZATION',
            role: 'CREATE_CHAIN',
          },
        });
      const created = await post('/supply-chains', producerToken, {
        name: `Activation HTTP ${randomUUID()}`,
      }).expect(201);
      const id = created.body.data.id as string;
      const profile = await get(
        `/supply-chains/${id}/business-profile`,
        producerToken,
      ).expect(200);
      expect(profile.body.data).toMatchObject({
        chainId: id,
        state: 'PREPARING',
        version: 0,
        scopeVersion: 1,
      });
      return id;
    }

    it('creates a PREPARING profile and reconciles activation with current owner authority', async () => {
      const id = await preparingChain();
      const path = `/supply-chains/${id}/business-profile/activate`;
      const key = randomUUID();
      const body = { version: 0 };
      for (let attempt = 0; attempt < 2; attempt++) {
        const activated = await post(path, producerToken, body, key).expect(
          201,
        );
        expect(activated.body.data).toMatchObject({
          chainId: id,
          state: 'ACTIVE',
          version: 1,
        });
      }
      const status = await post(
        '/command-requests/status',
        producerToken,
        {
          operation: 'HYB_ACTIVATE_BUSINESS_PROFILE',
          payload: { ...body, chainId: id },
        },
        key,
      ).expect(200);
      expect(status.body.data).toMatchObject({ status: 'COMMITTED' });
      expect(
        await db.chainAudit.count({
          where: { chainId: id, operation: 'ACTIVATE_BUSINESS_PROFILE' },
        }),
      ).toBe(1);
      const manager = await db.scopedRoleGrant.findFirstOrThrow({
        where: { chainId: id, userId: producer.sub!, role: 'CHAIN_MANAGER' },
      });
      await db.scopedRoleGrant.update({
        where: { id: manager.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      // The SQL fixture retains ORG_ADMIN for metadata reads; it cannot
      // replace the revoked owner CHAIN_MANAGER for business activation.
      await post(path, producerToken, body, key).expect(403);
      await post(
        '/command-requests/status',
        producerToken,
        {
          operation: 'HYB_ACTIVATE_BUSINESS_PROFILE',
          payload: { ...body, chainId: id },
        },
        key,
      ).expect(403);
    });

    it('serializes distinct concurrent activation commands into one profile transition and one audit', async () => {
      const id = await preparingChain();
      const path = `/supply-chains/${id}/business-profile/activate`;
      const results = await Promise.all([
        post(path, producerToken, { version: 0 }),
        post(path, producerToken, { version: 0 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await db.chainBusinessProfile.findUniqueOrThrow({
          where: { chainId: id },
        }),
      ).toMatchObject({ state: 'ACTIVE', version: 1 });
      expect(
        await db.chainAudit.count({
          where: { chainId: id, operation: 'ACTIVATE_BUSINESS_PROFILE' },
        }),
      ).toBe(1);
    });

    it('exports the actual plan command, consent and projection schemas in NestJS Swagger', () => {
      const document = createOpenApiDocument(app);
      expect(
        document.paths['/api/supply-chains/{chainId}/shipment-plans']?.post,
      ).toBeDefined();
      expect(
        document.paths[
          '/api/supply-chains/{chainId}/shipment-plans/{planId}/finalize'
        ]?.post,
      ).toBeDefined();
      expect(
        document.components?.schemas?.AcceptShipmentPlanDto,
      ).toHaveProperty('properties.payloadDigest');
      expect(
        document.components?.schemas?.ShipmentPlanRecordDto,
      ).toHaveProperty('properties.current');
    });

    it('creates, accepts and finalizes over HTTP without exposing grant or user IDs in projections', async () => {
      const { lot, input } = await db.$transaction((tx) => freshPlan(tx), {
        timeout: 20000,
      });
      await db.$transaction(
        async (tx) => {
          const event = await trace.createInTransaction(tx, {
            entityType: 'HARVEST',
            entityId: lot.harvestId!,
            cycleId,
            lotId: lot.id,
            eventType: 'HARVEST_RECORDED',
            actor: producer,
            businessData: { quantity: '5', unit: 'kg' },
          });
          await tx.quantityMovement.create({
            data: {
              lotId: lot.id,
              eventId: event.id,
              type: 'HARVEST_IN',
              quantity: '5',
              unit: 'kg',
              beforeQty: '0',
              delta: '5',
              afterQty: '5',
            },
          });
        },
        { timeout: 20000 },
      );
      const url = `/supply-chains/${chainId}/shipment-plans`;
      const key = randomUUID();
      const created = await post(
        url,
        producerToken,
        { lotId: lot.id, ...input },
        key,
      ).expect(201);
      const plan = created.body.data;
      expect(
        (
          await post(
            url,
            producerToken,
            { lotId: lot.id, ...input },
            key,
          ).expect(201)
        ).body.data.id,
      ).toBe(plan.id);
      for (const [party, token] of [
        ['PRODUCER', producerToken],
        ['TRANSPORTER', transporterToken],
        ['RETAILER', retailerToken],
      ] as const) {
        const accepted = await post(`${url}/${plan.id}/accept`, token, {
          party,
          revision: 0,
          payloadDigest: plan.current.payloadDigest,
        }).expect(201);
        expect(accepted.body.data).not.toHaveProperty('grantId');
        expect(accepted.body.data).not.toHaveProperty('userId');
      }
      const projected = await request(app.getHttpServer())
        .get(`/api${url}/${plan.id}`)
        .set('Authorization', `Bearer ${transporterToken}`)
        .expect(200);
      expect(projected.body.data.current.acceptances).toHaveLength(3);
      expect(projected.body.data.current.acceptances[0]).not.toHaveProperty(
        'grantId',
      );
      const finalized = await post(
        `${url}/${plan.id}/finalize`,
        producerToken,
        { version: 0 },
      ).expect(201);
      expect(finalized.body.data.shipmentId).toBeTruthy();
      expect(await db.shipment.count({ where: { lotId: lot.id } })).toBe(1);
    });

    it('rejects producer direct Shipment creation and partner production writes on scoped subjects', async () => {
      const { lot } = await db.$transaction((tx) => freshPlan(tx), {
        timeout: 20000,
      });
      await post('/shipments', producerToken, {
        lotId: lot.id,
        transporterOrgId: transporter.organizationId,
        retailerOrgId: retailer.organizationId,
        origin: 'farm',
        destination: 'shop',
      }).expect(403);
      await post(`/production-cycles/${cycleId}/plant`, transporterToken, {
        version: 0,
        plantedAt: new Date().toISOString(),
      }).expect(403);
      expect(await db.shipment.count({ where: { lotId: lot.id } })).toBe(0);
    });

    it('creates scoped Cycle, assignment, trace/outbox and replays without duplicates', async () => {
      const payload = {
        chainId,
        farmId,
        productId,
        cycleCode: randomUUID(),
        maxHarvestQuantity: 10,
        harvestUnit: 'kg',
      };
      const key = randomUUID();
      const created = await post(
        '/production-cycles',
        producerToken,
        payload,
        key,
      ).expect(201);
      const id = created.body.data.id;
      expect(created.body.data.chainId).toBe(chainId);
      expect(
        (
          await post('/production-cycles', producerToken, payload, key).expect(
            201,
          )
        ).body.data.id,
      ).toBe(id);
      expect(
        await db.stageAssignment.count({
          where: { cycleId: id, chainId, status: 'ACCEPTED' },
        }),
      ).toBe(1);
      const event = await db.traceEvent.findFirstOrThrow({
        where: { cycleId: id, eventType: 'PRODUCTION_CYCLE_CREATED' },
      });
      expect(event.businessData).toMatchObject({ chainId, scopeVersion: 1 });
      expect(
        await db.eventChainContext.count({
          where: { eventId: event.id, chainId },
        }),
      ).toBe(1);
      expect(
        await db.blockchainOutbox.count({ where: { eventId: event.id } }),
      ).toBe(1);
      await post('/production-cycles', producerToken, {
        ...payload,
        chainId: undefined,
        cycleCode: randomUUID(),
      }).expect(400); // chainId is required by the contract
    });

    it('rejects a stream without an ACTIVE binding before any domain, trace, outbox or positive journal write', async () => {
      const { activeBindingDigest: digest } =
        await db.chainLedgerProfile.findUniqueOrThrow({ where: { chainId } });
      const cycleCode = randomUUID();
      const key = randomUUID();
      const counts = async () =>
        Promise.all([
          db.productionCycle.count(),
          db.traceEvent.count(),
          db.blockchainOutbox.count(),
          db.commandCommit.count(),
        ]);
      const before = await counts();
      try {
        await db.$transaction((tx) => setBindingPaused(tx, digest!, true));
        const body = {
          chainId,
          farmId,
          productId,
          cycleCode,
          maxHarvestQuantity: 10,
          harvestUnit: 'kg',
        };
        await post('/production-cycles', producerToken, body, key).expect(409);
        await post('/production-cycles', producerToken, body, key).expect(409);
        expect(await counts()).toEqual(before);
        expect(await db.productionCycle.count({ where: { cycleCode } })).toBe(
          0,
        );
      } finally {
        await db.$transaction((tx) => setBindingPaused(tx, digest!, false));
      }
    });

    it('derives transporter and retail actors from scoped authority across the physical flow', async () => {
      const { plan, lot } = await db.$transaction((tx) => acceptedPlan(tx), {
        timeout: 20000,
      });
      const finalized = await db.$transaction(
        (tx) => finalizeShipmentPlan(tx, producer, plan.id, 0, trace),
        { timeout: 20000 },
      );
      const id = finalized.shipment.id;
      await post(`/shipments/${id}/start`, transporterToken, {
        version: 0,
        lotVersion: 0,
      }).expect(201);
      await post(`/shipments/${id}/arrive`, transporterToken, {
        version: 1,
        lotVersion: 1,
      }).expect(201);
      await post(`/shipments/${id}/receive`, retailerToken, {
        version: 2,
        lotVersion: 2,
        receivedQuantity: 5,
      }).expect(201);
      await post(`/lots/${lot.id}/mark-for-sale`, retailerToken, {
        version: 3,
        shipmentVersion: 3,
      }).expect(201);
      const sold = await post(`/lots/${lot.id}/mark-sold`, retailerToken, {
        version: 4,
        shipmentVersion: 3,
      }).expect(201);
      expect(sold.body.data.currentState).toBe('SOLD');
      const events = await db.traceEvent.findMany({
        where: {
          lotId: lot.id,
          eventType: {
            in: [
              'SHIPMENT_STARTED',
              'SHIPMENT_ARRIVED',
              'SHIPMENT_RECEIVED',
              'MARKED_FOR_SALE',
              'LOT_SOLD',
            ],
          },
        },
        include: { bindingContext: EVENT_BINDING_CONTEXT_INCLUDE },
      });
      expect(events.map((event) => event.eventType).sort()).toEqual(
        [
          'SHIPMENT_STARTED',
          'SHIPMENT_ARRIVED',
          'SHIPMENT_RECEIVED',
          'MARKED_FOR_SALE',
          'LOT_SOLD',
        ].sort(),
      );
      expect(
        events.find((e) => e.eventType === 'SHIPMENT_STARTED')?.actorRole,
      ).toBe('TRANSPORTER');
      expect(
        events.find((e) => e.eventType === 'SHIPMENT_RECEIVED')?.actorRole,
      ).toBe('RETAILER');
      expect(events.every((e) => privateTraceEvidenceMatches(e))).toBe(true);
      for (const event of events)
        expect(
          await db.eventChainContext.count({
            where: { eventId: event.id, chainId },
          }),
        ).toBe(1);
    });

    it('filters direct IDs, proof, compliance, IoT and nested cycles across chains sharing one Farm/org', async () => {
      // Another member of the same organization writes the hidden chain's
      // events; the producer itself holds no grant on that chain.
      const template = await db.user.findUniqueOrThrow({
        where: { id: producer.sub! },
      });
      const writerUser = await db.user.create({
        data: {
          organizationId: producer.organizationId,
          roleId: template.roleId,
          email: `${randomUUID()}@example.test`,
          fullName: 'Hidden chain writer',
          passwordHash: 'unused-synthetic-hash',
        },
      });
      const hiddenWriter = { ...producer, sub: writerUser.id };
      await db.$transaction((tx) =>
        grant(tx, hiddenWriter, 'FARM_STAFF', otherChainId),
      );
      const hidden = await db.$transaction(
        async (tx) => {
          const cycle = await tx.productionCycle.create({
            data: {
              farmId,
              productId,
              farmOrgId: producer.organizationId!,
              chainId: otherChainId,
              cycleCode: randomUUID(),
            },
          });
          await bindCycle(tx, cycle.id, otherChainId);
          await tx.stageAssignment.create({
            data: {
              chainId: otherChainId,
              organizationId: producer.organizationId!,
              stage: 'PRODUCTION',
              cycleId: cycle.id,
              status: 'ACCEPTED',
            },
          });
          const harvest = await tx.harvestEvent.create({
            data: {
              cycleId: cycle.id,
              harvestTime: new Date(),
              quantity: '5',
              unit: 'kg',
            },
          });
          const lot = await tx.lot.create({
            data: {
              lotCode: randomUUID(),
              harvestId: harvest.id,
              productId,
              farmOrgId: producer.organizationId!,
              initialQuantity: '5',
              availableQuantity: '5',
              unit: 'kg',
            },
          });
          const event = await trace.createInTransaction(tx, {
            entityType: 'HARVEST',
            entityId: harvest.id,
            cycleId: cycle.id,
            lotId: lot.id,
            eventType: 'HARVEST_RECORDED',
            actor: hiddenWriter,
            businessData: { quantity: '5', unit: 'kg' },
          });
          const device = await tx.iotDevice.create({
            data: {
              organizationId: producer.organizationId!,
              cycleId: cycle.id,
              deviceCode: randomUUID(),
              name: 'Hidden scope device',
              type: 'temperature',
            },
          });
          await tx.certificate.create({
            data: {
              cycleId: cycle.id,
              type: 'Quality',
              issuer: 'Fixture',
              issueDate: new Date(),
              documentRef: 'fixture://certificate',
              documentHash: 'e'.repeat(64),
              submittedByUserId: producer.sub,
            },
          });
          return { cycle, lot, event, device };
        },
        { timeout: 20000 },
      );
      await get(`/production-cycles/${hidden.cycle.id}`, producerToken).expect(
        404,
      );
      await get(`/lots/${hidden.lot.id}`, producerToken).expect(404);
      await get(`/trace/lots/${hidden.lot.id}`, producerToken).expect(404);
      await get(`/trace/events/${hidden.event.id}/proof`, producerToken).expect(
        404,
      );
      expect(
        (
          await get(
            `/certificates?cycleId=${hidden.cycle.id}`,
            producerToken,
          ).expect(200)
        ).body.data,
      ).toEqual([]);
      expect(
        (await get('/iot/devices', producerToken).expect(200)).body.data.some(
          (row: { id: string }) => row.id === hidden.device.id,
        ),
      ).toBe(false);
      expect(
        (
          await get('/production-cycles', producerToken).expect(200)
        ).body.data.some((row: { id: string }) => row.id === hidden.cycle.id),
      ).toBe(false);
    });

    it('prunes another chain cycle from a device shared with a visible Shipment', async () => {
      const device = await db.$transaction(
        async (tx) => {
          await tx.organizationCapability.upsert({
            where: {
              organizationId_code: {
                organizationId: transporter.organizationId!,
                code: 'FARM',
              },
            },
            create: {
              organizationId: transporter.organizationId!,
              code: 'FARM',
            },
            update: {},
          });
          const farm = await tx.farm.create({
            data: {
              organizationId: transporter.organizationId!,
              name: 'Transporter own farm',
            },
          });
          const cycle = await tx.productionCycle.create({
            data: {
              farmId: farm.id,
              farmOrgId: transporter.organizationId!,
              productId,
              chainId: otherChainId,
              cycleCode: randomUUID(),
            },
          });
          await bindCycle(tx, cycle.id, otherChainId);
          const device = await tx.iotDevice.create({
            data: {
              organizationId: transporter.organizationId!,
              cycleId: cycle.id,
              deviceCode: randomUUID(),
              name: 'Shared tracking device',
              type: 'temperature',
            },
          });
          await tx.shipmentTrackingBinding.create({
            data: {
              shipmentId,
              deviceId: device.id,
              transporterOrgId: transporter.organizationId!,
            },
          });
          return device;
        },
        { timeout: 20000 },
      );
      const shipment = await get(
        `/shipments/${shipmentId}`,
        transporterToken,
      ).expect(200);
      const binding = shipment.body.data.trackingBindings.find(
        (row: { deviceId: string }) => row.deviceId === device.id,
      );
      expect(binding.device.id).toBe(device.id);
      expect(binding.device.cycleId).toBeNull();
      const devices = await get('/iot/devices', transporterToken).expect(200);
      const shared = devices.body.data.find(
        (row: { id: string }) => row.id === device.id,
      );
      expect(shared.cycleId).toBeNull();
      expect(shared.cycle).toBeNull();
      await get(
        `/production-cycles/${device.cycleId}`,
        transporterToken,
      ).expect(404);
    });

    it('rejects producer organization self-review across users despite AUDITOR capability and assignment', async () => {
      const user = await db.$transaction(
        async (tx) => {
          if (
            !(await tx.organizationCapability.findUnique({
              where: {
                organizationId_code: {
                  organizationId: producer.organizationId!,
                  code: 'AUDITOR',
                },
              },
            }))
          )
            await tx.organizationCapability.create({
              data: {
                organizationId: producer.organizationId!,
                code: 'AUDITOR',
              },
            });
          const template = await tx.user.findUniqueOrThrow({
            where: { id: producer.sub! },
          });
          const user = await tx.user.create({
            data: {
              organizationId: producer.organizationId,
              roleId: template.roleId,
              email: `${randomUUID()}@example.test`,
              fullName: 'Other producer reviewer',
              passwordHash: 'unused-synthetic-hash',
            },
          });
          await grant(tx, { ...producer, sub: user.id }, 'COMPLIANCE_REVIEWER');
          await tx.complianceAssignment.create({
            data: { reviewerUserId: user.id, farmId },
          });
          return user;
        },
        { timeout: 20000 },
      );
      const actor = await authenticated({ ...producer, sub: user.id });
      const token = app.get(JwtService).sign({ sub: user.id, sid: actor.sid });
      const count = await db.inspection.count();
      await post('/inspections', token, {
        lotId,
        result: 'PASS',
        inspectedAt: new Date().toISOString(),
      }).expect(403);
      expect(await db.inspection.count()).toBe(count);
    });

    it('creates production with a scoped FARM_STAFF grant while the authenticated global role remains TRANSPORTER', async () => {
      const actor = await db.$transaction(
        async (tx) => {
          const role = await tx.role.upsert({
            where: { code: 'TRANSPORTER' },
            create: { code: 'TRANSPORTER', name: 'Transporter' },
            update: {},
          });
          const user = await tx.user.create({
            data: {
              organizationId: producer.organizationId,
              roleId: role.id,
              email: `${randomUUID()}@example.test`,
              fullName: 'Scoped production actor',
              passwordHash: 'unused-synthetic-hash',
            },
          });
          const actor = {
            sub: user.id,
            organizationId: producer.organizationId,
            role: 'TRANSPORTER',
          };
          await grant(tx, actor, 'FARM_STAFF');
          await grantWorkspaceProductionRole(tx, actor);
          return actor;
        },
        { timeout: 20000 },
      );
      const session = await authenticated(actor);
      const token = app
        .get(JwtService)
        .sign({ sub: actor.sub, sid: session.sid });
      await get('/catalog', token).expect(200);
      const created = await post('/production-cycles', token, {
        chainId,
        farmId,
        productId,
        cycleCode: randomUUID(),
        maxHarvestQuantity: 5,
        harvestUnit: 'kg',
      }).expect(201);
      const event = await db.traceEvent.findFirstOrThrow({
        where: { cycleId: created.body.data.id },
      });
      expect(event.actorRole).toBe('FARM_STAFF');
      expect(
        (
          await db.user.findUniqueOrThrow({
            where: { id: actor.sub },
            include: { role: true },
          })
        ).role.code,
      ).toBe('TRANSPORTER');
      expect(
        (
          await get(`/production-cycles/${created.body.data.id}`, token).expect(
            200,
          )
        ).body.data.canWriteProduction,
      ).toBe(true);
    });

    it('changes UI revision and closes private reads and create replay after scoped grant revocation', async () => {
      const scoped = await db.$transaction(async (tx) => {
        const template = await tx.user.findUniqueOrThrow({
          where: { id: producer.sub! },
        });
        const user = await tx.user.create({
          data: {
            organizationId: producer.organizationId,
            roleId: template.roleId,
            email: `${randomUUID()}@example.test`,
            fullName: 'Temporary scoped producer',
            passwordHash: 'unused-synthetic-hash',
          },
        });
        const actor = { ...producer, sub: user.id };
        const permission = await grant(tx, actor, 'FARM_STAFF');
        await grantWorkspaceProductionRole(tx, actor);
        return { actor, permission };
      });
      const session = await authenticated(scoped.actor);
      const token = app
        .get(JwtService)
        .sign({ sub: scoped.actor.sub, sid: session.sid });
      const key = randomUUID();
      const body = {
        chainId,
        farmId,
        productId,
        cycleCode: randomUUID(),
        maxHarvestQuantity: 5,
        harvestUnit: 'kg',
      };
      const created = await post('/production-cycles', token, body, key).expect(
        201,
      );
      const id = created.body.data.id;
      await post('/production-cycles', token, body, key).expect(201);
      const record = await db.idempotencyRecord.findUniqueOrThrow({
        where: {
          requesterId_operation_idempotencyKey: {
            requesterId: scoped.actor.sub!,
            operation: 'CREATE_PRODUCTION_CYCLE',
            idempotencyKey: key,
          },
        },
      });
      const journal = await db.commandCommit.findUniqueOrThrow({
        where: { idempotencyRecordId: record.id },
      });
      const before = await get('/chain-permissions', token).expect(200);
      expect(before.body.data.accessRevision).toMatch(/^[a-f0-9]{64}$/);
      await db.scopedRoleGrant.update({
        where: { id: scoped.permission.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      const after = await get('/chain-permissions', token).expect(200);
      expect(after.body.data.accessRevision).not.toBe(
        before.body.data.accessRevision,
      );
      await get(`/production-cycles/${id}`, token).expect(404);
      await post('/production-cycles', token, body, key).expect(403);
      expect(await db.productionCycle.count({ where: { id } })).toBe(1);
      expect(
        await db.commandCommit.findUnique({
          where: { idempotencyRecordId: record.id },
        }),
      ).toEqual(journal);
    });

    it('projects reviewer command availability and permits scoped inspection while the authenticated global role is TRANSPORTER', async () => {
      const actor = await db.$transaction(async (tx) => {
        const role = await tx.role.findUniqueOrThrow({
          where: { code: 'TRANSPORTER' },
        });
        const user = await tx.user.create({
          data: {
            organizationId: reviewer.organizationId,
            roleId: role.id,
            email: `${randomUUID()}@example.test`,
            fullName: 'Mixed-role reviewer',
            passwordHash: 'unused-synthetic-hash',
          },
        });
        const actor = { ...reviewer, sub: user.id, role: 'TRANSPORTER' };
        await grant(tx, actor, 'COMPLIANCE_REVIEWER');
        await tx.complianceAssignment.create({
          data: { reviewerUserId: user.id, farmId },
        });
        return actor;
      });
      const session = await authenticated(actor);
      const token = app
        .get(JwtService)
        .sign({ sub: actor.sub, sid: session.sid });
      const cycles = await get('/production-cycles', token).expect(200);
      const root = cycles.body.data.find(
        (row: { id: string }) => row.id === cycleId,
      );
      expect(root.canReviewCompliance).toBe(true);
      expect(root.canWriteProduction).toBe(false);
      const inspection = await post('/inspections', token, {
        lotId,
        result: 'PASS',
        inspectedAt: new Date().toISOString(),
      }).expect(201);
      const event = await db.traceEvent.findFirstOrThrow({
        where: { entityType: 'INSPECTION', entityId: inspection.body.data.id },
      });
      expect(event.actorRole).toBe('COMPLIANCE_REVIEWER');
      expect(event.actorUserId).toBe(actor.sub);
      const producerCycles = await get(
        '/production-cycles',
        producerToken,
      ).expect(200);
      expect(
        producerCycles.body.data.every(
          (row: { canReviewCompliance: boolean }) => !row.canReviewCompliance,
        ),
      ).toBe(true);
    });
  });
});
