import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { CommandActor } from '../../src/common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../src/common/crypto/rfc8785.js';
import { inventoryLegacyScope } from '../../src/modules/supply-chains/legacy-scope-inventory.js';
import { planLegacyScopeAssignments } from '../../src/modules/supply-chains/legacy-scope-plan.js';
import type { LegacyScopePin } from '../../src/modules/supply-chains/legacy-scope-pins.js';
import type { TraceService } from '../../src/modules/trace/trace.service.js';

/** Every party starts uncutover. The owner has its own ACTIVE membership.
 * Existing unrelated legacy roots remain unresolved outside this chain, so
 * committed HTTP scenarios do not consume another suite's baseline fixture. */
export async function legacyHistoryFixture(
  db: Prisma.TransactionClient,
  trace: TraceService,
) {
  const actors: CommandActor[] = [];
  for (const [type, code] of [
    ['FARM', 'FARM_STAFF'],
    ['TRANSPORTER', 'TRANSPORTER'],
    ['RETAILER', 'RETAILER'],
  ] as const) {
    const role = await db.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const organization = await db.organization.create({
      data: { name: `Isolated history ${randomUUID()}`, type },
    });
    const user = await db.user.create({
      data: {
        organizationId: organization.id,
        roleId: role.id,
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-isolated-fixture',
        fullName: 'Synthetic participant',
      },
    });
    await db.scopedRoleGrant.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        scope: 'ORGANIZATION',
        role: 'ORG_ADMIN',
      },
    });
    actors.push({ sub: user.id, organizationId: organization.id, role: code });
  }
  const [producer, transporter, retailer] = actors;
  const operatorRole = await db.role.upsert({
    where: { code: 'SYSTEM_ADMIN' },
    update: {},
    create: { code: 'SYSTEM_ADMIN', name: 'Operator' },
  });
  const operator = await db.user.create({
    data: {
      roleId: operatorRole.id,
      email: `${randomUUID()}@example.test`,
      passwordHash: 'unused-isolated-fixture',
      fullName: 'Synthetic operator',
    },
  });
  const operatorActor: CommandActor = {
    sub: operator.id,
    organizationId: null,
    role: 'SYSTEM_ADMIN',
  };
  const farm = await db.farm.create({
    data: {
      organizationId: producer.organizationId!,
      name: 'Isolated history farm',
    },
  });
  const product = await db.product.create({
    data: { productName: randomUUID(), defaultUnit: 'kg' },
  });
  const cycles = [];
  const lotIds: string[] = [];
  const eventIds: string[] = [];
  for (const harvestCount of [2, 1]) {
    const created = await db.productionCycle.create({
      data: {
        cycleCode: randomUUID(),
        farmId: farm.id,
        farmOrgId: producer.organizationId!,
        productId: product.id,
        maxHarvestQuantity: '20',
        harvestUnit: 'kg',
      },
    });
    const cycle = await db.productionCycle.update({
      where: { id: created.id },
      data: {
        state: 'PLANTED',
        version: { increment: 1 },
        startDate: new Date(),
      },
    });
    cycles.push(cycle);
    await db.careRecord.create({
      data: {
        cycleId: cycle.id,
        careType: 'WATERING',
        eventTime: new Date(),
        note: 'Private history fixture',
      },
    });
    for (let index = 0; index < harvestCount; index++) {
      const harvest = await db.harvestEvent.create({
        data: {
          cycleId: cycle.id,
          harvestTime: new Date(),
          quantity: '5',
          unit: 'kg',
        },
      });
      const lot = await db.lot.create({
        data: {
          lotCode: randomUUID(),
          harvestId: harvest.id,
          productId: product.id,
          farmOrgId: producer.organizationId!,
          initialQuantity: '5',
          availableQuantity: '5',
          unit: 'kg',
        },
      });
      lotIds.push(lot.id);
      const shipment = await db.shipment.create({
        data: {
          lotId: lot.id,
          transporterOrgId: transporter.organizationId!,
          retailerOrgId: retailer.organizationId!,
          shippedQuantity: '5',
          unit: 'kg',
          origin: 'Synthetic farm',
          destination: 'Synthetic shop',
        },
      });
      const event = await trace.createInTransaction(db, {
        entityType: 'HARVEST',
        entityId: harvest.id,
        cycleId: cycle.id,
        lotId: lot.id,
        eventType: 'HARVEST_RECORDED',
        actor: producer,
        businessData: { quantity: '5', unit: 'kg' },
      });
      eventIds.push(event.id);
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
      await db.traceQr.create({
        data: {
          lotId: lot.id,
          traceToken: randomUUID(),
          traceUrl: 'https://example.test/isolated-qr',
        },
      });
      // Synthetic preservation evidence only. This row is not a Fabric commit.
      await db.blockchainProof.create({
        data: {
          eventId: event.id,
          network: 'synthetic-rehearsal',
          channelId: 'isolated-fixture',
          txId: `synthetic-${randomUUID()}`,
          dataHash: event.dataHash,
          transactionStatus: 'CONFIRMED',
          recordedAt: new Date(),
        },
      });
      await db.blockchainOutbox.update({
        where: { eventId: event.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          nextAttemptAt: null,
        },
      });
      const shipmentEvent = await trace.createInTransaction(db, {
        entityType: 'SHIPMENT',
        entityId: shipment.id,
        cycleId: cycle.id,
        lotId: lot.id,
        eventType: 'SHIPMENT_CREATED',
        actor: producer,
        businessData: { quantity: '5', unit: 'kg' },
      });
      eventIds.push(shipmentEvent.id);
    }
  }
  const chain = await db.supplyChain.create({
    data: { name: randomUUID(), ownerOrganizationId: producer.organizationId! },
  });
  await db.chainBusinessProfile.create({ data: { chainId: chain.id } });
  for (const actor of actors)
    await db.chainMembership.create({
      data: {
        chainId: chain.id,
        organizationId: actor.organizationId!,
        status: 'ACTIVE',
      },
    });
  for (const [actor, role] of [
    [producer, 'CHAIN_MANAGER'],
    [producer, 'FARM_STAFF'],
    [transporter, 'TRANSPORTER'],
    [retailer, 'RETAILER'],
  ] as const)
    await db.scopedRoleGrant.create({
      data: {
        chainId: chain.id,
        userId: actor.sub!,
        organizationId: actor.organizationId!,
        scope: 'CHAIN',
        role,
      },
    });
  const inventory = await inventoryLegacyScope(db);
  const own = new Set(cycles.map((c) => c.id));
  const manifest = {
    schema: 'agritrace-legacy-scope-manifest-1' as const,
    id: randomUUID(),
    sourceSha: 'a'.repeat(40),
    environment: 'isolated' as const,
    inventoryDigest: inventory.digest,
    operatorId: operator.id,
    reviewerId: producer.sub!,
    reviewEvidenceDigest: 'b'.repeat(64),
    entries: inventory.roots.map((r) => ({
      cycleId: r.cycleId,
      producerOrgId: r.producerOrgId,
      expectedVersion: r.version,
      inventoryDigest: r.inventoryDigest,
      decision: own.has(r.cycleId) ? ('MAP' as const) : ('UNRESOLVED' as const),
      chainId: own.has(r.cycleId) ? chain.id : null,
    })),
  };
  const digest = canonicalSha256(manifest);
  const plan = await planLegacyScopeAssignments(
    db,
    manifest,
    inventory,
    digest,
    { environment: 'isolated', sourceSha: manifest.sourceSha },
  );
  const pin: LegacyScopePin = { manifest, digest, plan };
  return {
    pin,
    chain,
    actors,
    producer,
    transporter,
    retailer,
    operator: operatorActor,
    cycles,
    lotIds,
    eventIds,
  };
}

export function installLegacyPin(...pins: LegacyScopePin[]) {
  const directory = mkdtempSync(join(tmpdir(), 'agritrace-history-pin-'));
  const file = join(directory, 'pins.json');
  const previous = process.env.HYBRID_LEGACY_MANIFEST_PINS_FILE;
  const previousGate = process.env.HYBRID_LEGACY_APPLY_ENABLED;
  writeFileSync(
    file,
    JSON.stringify({ schema: 'agritrace-legacy-scope-pins-1', pins }),
    { mode: 0o600 },
  );
  process.env.HYBRID_LEGACY_MANIFEST_PINS_FILE = file;
  process.env.HYBRID_LEGACY_APPLY_ENABLED = '1';
  return {
    file,
    restore() {
      if (previous === undefined)
        delete process.env.HYBRID_LEGACY_MANIFEST_PINS_FILE;
      else process.env.HYBRID_LEGACY_MANIFEST_PINS_FILE = previous;
      if (previousGate === undefined)
        delete process.env.HYBRID_LEGACY_APPLY_ENABLED;
      else process.env.HYBRID_LEGACY_APPLY_ENABLED = previousGate;
      unlinkSync(file);
      rmdirSync(directory);
    },
  };
}
