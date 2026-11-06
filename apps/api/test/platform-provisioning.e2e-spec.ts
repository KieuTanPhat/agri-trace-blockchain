import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.js';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }),
});
describe('Shared platform provisioning database invariants', () => {
  afterAll(() => db.$disconnect());
  it('enqueues exactly one job for each chain in its creation transaction', async () => {
    const organization = await db.organization.create({
      data: { name: 'Provisioning isolation', type: 'FARM' },
    });
    const chains = await db.$transaction(async (tx) => {
      const created = await Promise.all(
        [false, true].map((personal) =>
          tx.supplyChain.create({
            data: {
              name: `Provisioning ${randomUUID()}`,
              ownerOrganizationId: organization.id,
              personal,
            },
          }),
        ),
      );
      for (const chain of created)
        await tx.chainMembership.create({
          data: {
            chainId: chain.id,
            organizationId: organization.id,
            status: 'ACTIVE',
          },
        });
      return created;
    });
    expect(
      await db.ledgerProvisioningJob.count({
        where: { chainId: { in: chains.map((c) => c.id) } },
      }),
    ).toBe(2);
    for (const chain of chains) {
      expect(
        await db.ledgerProvisioningJob.findUnique({
          where: { chainId: chain.id },
        }),
      ).toMatchObject({ status: 'PENDING', bindingDigest: null });
    }
    const rollbackId = randomUUID();
    await expect(
      db.$transaction(async (tx) => {
        await tx.supplyChain.create({
          data: {
            id: rollbackId,
            name: 'Rolled back',
            ownerOrganizationId: organization.id,
          },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(
      await db.ledgerProvisioningJob.findUnique({
        where: { chainId: rollbackId },
      }),
    ).toBeNull();
  });
  it('has no enterprise-MSP allocation or peer connection table, and only SERVICE profile', async () => {
    const result = await db.$queryRaw<
      Array<{ allocation: string | null; connection: string | null }>
    >`
      SELECT to_regclass('enterprise_msp_allocation')::text AS allocation, to_regclass('enterprise_connection')::text AS connection`;
    expect(result[0]).toEqual({ allocation: null, connection: null });
    const profiles = await db.$queryRaw<
      Array<{ value: string }>
    >`SELECT unnest(enum_range(NULL::ledger_profile))::text AS value`;
    expect(profiles.map((p) => p.value)).toEqual(['SERVICE']);
  });
});
