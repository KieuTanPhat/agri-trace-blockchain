import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  type Prisma,
  type ScopedRole,
} from '../src/generated/prisma/client.js';
import type { CommandActor } from '../src/common/idempotency/command-authorization.js';
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
  reviseShipmentPlan,
  shipmentPlanDigest,
} from '../src/modules/supply-chains/shipment-plan.commands.js';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
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
  return tx.scopedRoleGrant.create({
    data: {
      userId: actor.sub!,
      organizationId: actor.organizationId!,
      chainId: chain,
      scope: 'CHAIN',
      role,
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

describe('Candidate scoped command policy on PostgreSQL draft (not core endpoint acceptance)', () => {
  beforeAll(async () => {
    // These exact fixtures exist only in the isolated draft scenarios. Fail
    // before any mutation if the operator supplied the wrong database.
    const plans = await db.shipmentPlan.findMany({
      where: { status: 'FINALIZED', lot: { lotCode: 'scope-lot' } },
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
    cycleId = plan.lot.harvest.cycleId;
    lotId = plan.lotId;
    shipmentId = plan.shipmentId!;
    farmId = plan.lot.harvest.cycle.farmId;
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
  it('does not derive scoped authority from a legacy unmapped root', () =>
    isolated(async (tx) => {
      const legacy = await tx.productionCycle.findFirstOrThrow({
        where: { cycleCode: 'legacy-before-cutover' },
      });
      await expect(
        authority(tx, producer, 'FARM_STAFF', chainId, legacy.id),
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
      const beforeEvents = await tx.traceEvent.count();
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
      expect(await tx.traceEvent.count()).toBe(beforeEvents);
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

  it('retains old consent and requires new consent after revision, with stale version protection', () =>
    isolated(async (tx) => {
      const { lot, input } = await freshPlan(tx);
      const plan = await createShipmentPlan(
        tx,
        producer,
        chainId,
        lot.id,
        input,
      );
      const old = await acceptShipmentPlan(
        tx,
        producer,
        plan.id,
        'PRODUCER',
        0,
        plan.current.payloadDigest,
      );
      const next = await reviseShipmentPlan(tx, producer, plan.id, 0, {
        ...input,
        destination: 'new-shop',
      });
      expect(next.version).toBe(1);
      expect(next.currentRevision).toBe(1);
      expect(next.current.payloadDigest).not.toBe(plan.current.payloadDigest);
      expect(
        await tx.shipmentPlanAcceptance.findUnique({ where: { id: old.id } }),
      ).not.toBeNull();
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
      await expect(
        reviseShipmentPlan(tx, producer, plan.id, 0, input),
      ).rejects.toBeInstanceOf(ConflictException);
      await acceptShipmentPlan(
        tx,
        producer,
        plan.id,
        'PRODUCER',
        1,
        next.current.payloadDigest,
      );
      expect(
        await tx.shipmentPlanRevision.count({ where: { planId: plan.id } }),
      ).toBe(2);
      expect(
        await tx.shipmentPlanAcceptance.count({ where: { planId: plan.id } }),
      ).toBe(2);
    }));

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
});
