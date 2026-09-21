import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      connectionString ??
      'postgresql://postgres:postgres@localhost:5432/agri_trace_test',
  }),
});

const VALID_HASH = 'a'.repeat(64);
const INVALID_HASH = 'b'.repeat(64);

function createTag(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12);
}

async function expectDatabaseReject(
  operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<void> {
  await expect(prisma.$transaction(operation)).rejects.toThrow();
}

async function createCoreFixture(tx: Prisma.TransactionClient) {
  const tag = createTag();

  const farmOrganization = await tx.organization.create({
    data: {
      name: `Test Farm Organization ${tag}`,
      type: 'FARM',
      status: 'ACTIVE',
    },
  });

  const transporterOrganization = await tx.organization.create({
    data: {
      name: `Test Transporter Organization ${tag}`,
      type: 'TRANSPORTER',
      status: 'ACTIVE',
    },
  });

  const retailerOrganization = await tx.organization.create({
    data: {
      name: `Test Retailer Organization ${tag}`,
      type: 'RETAILER',
      status: 'ACTIVE',
    },
  });

  const product = await tx.product.create({
    data: {
      productName: `Rau cải xanh test ${tag}`,
      variety: 'Cải ngọt',
      defaultUnit: 'kg',
      status: 'ACTIVE',
    },
  });

  const farm = await tx.farm.create({
    data: {
      organizationId: farmOrganization.id,
      name: `Nông trại test ${tag}`,
      status: 'ACTIVE',
    },
  });

  const cycle = await tx.productionCycle.create({
    data: {
      cycleCode: `CYCLE-${tag}`,
      productId: product.id,
      farmId: farm.id,
      farmOrgId: farmOrganization.id,
      currentState: 'PLANTED',
      startDate: new Date(),
    },
  });

  const device = await tx.iotDevice.create({
    data: {
      organizationId: farmOrganization.id,
      cycleId: cycle.id,
      deviceCode: `DEVICE-${tag}`,
      name: `Thiết bị ${tag}`,
      type: 'TEMPERATURE_HUMIDITY',
      status: 'ACTIVE',
    },
  });

  const harvest = await tx.harvestEvent.create({
    data: {
      cycleId: cycle.id,
      harvestTime: new Date(),
      quantity: 100,
      unit: 'kg',
    },
  });

  const lot = await tx.lot.create({
    data: {
      lotCode: `LOT-${tag}`,
      harvestId: harvest.id,
      productId: product.id,
      farmOrgId: farmOrganization.id,
      initialQuantity: 100,
      availableQuantity: 100,
      unit: 'kg',
      currentState: 'HARVESTED',
    },
  });

  const traceEvent = await tx.traceEvent.create({
    data: {
      entityType: 'LOT',
      entityId: lot.id,
      lotId: lot.id,
      eventType: 'HARVEST_RECORDED',
      actorRole: 'FARM_STAFF',
      authProofType: 'SYSTEM_ASSERTION',
      actorAuthProof: `test-proof-${tag}`,
      eventTime: new Date(),
      businessData: { source: 'database-constraint-test' },
      schemaVersion: '2.0.0',
      canonicalizationVersion: 'RFC8785',
      dataHash: VALID_HASH,
    },
  });

  return {
    farmOrganization,
    transporterOrganization,
    retailerOrganization,
    product,
    farm,
    cycle,
    device,
    harvest,
    lot,
    traceEvent,
  };
}

(connectionString ? describe : describe.skip)(
  'PostgreSQL constraints and triggers',
  () => {
    afterAll(async () => {
      await prisma.$disconnect();
    });

    it('rejects duplicate role code', async () => {
      await expectDatabaseReject(async (tx) => {
        const tag = createTag();

        await tx.role.create({
          data: {
            code: `ROLE_${tag}`,
            name: 'Test role',
          },
        });

        await tx.role.create({
          data: {
            code: `ROLE_${tag}`,
            name: 'Duplicate test role',
          },
        });
      });
    });

    it('rejects duplicate user email', async () => {
      await expectDatabaseReject(async (tx) => {
        const tag = createTag();

        const role = await tx.role.create({
          data: {
            code: `ROLE_${tag}`,
            name: 'Test role',
          },
        });

        await tx.user.create({
          data: {
            email: `duplicate-${tag}@example.local`,
            fullName: 'Test user',
            passwordHash: 'not-a-real-password-hash',
            roleId: role.id,
          },
        });

        await tx.user.create({
          data: {
            email: `duplicate-${tag}@example.local`,
            fullName: 'Duplicate user',
            passwordHash: 'not-a-real-password-hash',
            roleId: role.id,
          },
        });
      });
    });

    it('rejects negative plot area', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);

        await tx.plot.create({
          data: {
            farmId: fixture.farm.id,
            name: 'Khu trồng có diện tích âm',
            area: -1,
            unit: 'm2',
            status: 'ACTIVE',
          },
        });
      });
    });

    it('rejects a farm owned by a non-FARM organization', async () => {
      await expectDatabaseReject(async (tx) => {
        const tag = createTag();

        const retailer = await tx.organization.create({
          data: {
            name: `Retailer cannot own farm ${tag}`,
            type: 'RETAILER',
            status: 'ACTIVE',
          },
        });

        await tx.farm.create({
          data: {
            organizationId: retailer.id,
            name: `Invalid farm ${tag}`,
            status: 'ACTIVE',
          },
        });
      });
    });

    it('rejects changing a farm owner to a non-FARM organization', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);

        await tx.farm.update({
          where: { id: fixture.farm.id },
          data: { organizationId: fixture.retailerOrganization.id },
        });
      });
    });

    it('rejects harvest quantity equal to zero', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);

        await tx.harvestEvent.create({
          data: {
            cycleId: fixture.cycle.id,
            harvestTime: new Date(),
            quantity: 0,
            unit: 'kg',
          },
        });
      });
    });

    it('rejects Lot available quantity greater than initial quantity', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);
        const tag = createTag();

        const secondHarvest = await tx.harvestEvent.create({
          data: {
            cycleId: fixture.cycle.id,
            harvestTime: new Date(),
            quantity: 100,
            unit: 'kg',
          },
        });

        await tx.lot.create({
          data: {
            lotCode: `INVALID-LOT-${tag}`,
            harvestId: secondHarvest.id,
            productId: fixture.product.id,
            farmOrgId: fixture.farmOrganization.id,
            initialQuantity: 100,
            availableQuantity: 101,
            unit: 'kg',
            currentState: 'HARVESTED',
          },
        });
      });
    });

    it('rejects SensorReading from a device bound to another cycle', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);
        const tag = createTag();

        const otherCycle = await tx.productionCycle.create({
          data: {
            cycleCode: `OTHER-CYCLE-${tag}`,
            productId: fixture.product.id,
            farmId: fixture.farm.id,
            farmOrgId: fixture.farmOrganization.id,
            currentState: 'CREATED',
          },
        });

        await tx.sensorReading.create({
          data: {
            deviceId: fixture.device.id,
            cycleId: otherCycle.id,
            sensorType: 'TEMPERATURE',
            value: 28.5,
            unit: 'C',
            recordedAt: new Date(),
          },
        });
      });
    });

    it('rejects Shipment whose quantity is not the full Lot quantity', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);

        await tx.shipment.create({
          data: {
            lotId: fixture.lot.id,
            transporterOrgId: fixture.transporterOrganization.id,
            retailerOrgId: fixture.retailerOrganization.id,
            origin: 'Nông trại Tân Phú',
            destination: 'Cửa hàng An Tâm',
            shippedQuantity: 99,
            unit: 'kg',
            status: 'CREATED',
          },
        });
      });
    });

    it('rejects BlockchainProof with a hash different from TraceEvent', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);

        await tx.blockchainProof.create({
          data: {
            eventId: fixture.traceEvent.id,
            network: 'fabric-local',
            dataHash: INVALID_HASH,
            transactionStatus: 'PENDING',
          },
        });
      });
    });

    it('rejects updating an append-only TraceEvent', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);

        await tx.traceEvent.update({
          where: {
            id: fixture.traceEvent.id,
          },
          data: {
            businessData: {
              changed: true,
            },
          },
        });
      });
    });

    it('rejects deleting an append-only TraceEvent', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);

        await tx.traceEvent.delete({
          where: {
            id: fixture.traceEvent.id,
          },
        });
      });
    });

    it('rejects an invalid ProductionCycle state transition', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);
        await tx.productionCycle.update({
          where: { id: fixture.cycle.id },
          data: { currentState: 'CREATED' },
        });
      });
    });

    it('rejects an invalid Shipment state transition', async () => {
      await expectDatabaseReject(async (tx) => {
        const fixture = await createCoreFixture(tx);
        const shipment = await tx.shipment.create({
          data: {
            lotId: fixture.lot.id,
            transporterOrgId: fixture.transporterOrganization.id,
            retailerOrgId: fixture.retailerOrganization.id,
            origin: 'Nông trại Tân Phú',
            destination: 'Cửa hàng An Tâm',
            shippedQuantity: 100,
            unit: 'kg',
          },
        });
        await tx.shipment.update({
          where: { id: shipment.id },
          data: { status: 'DELIVERED' },
        });
      });
    });
  },
);
