/**
 * One-off backfill: gives every active farm, retailer and distributor the own
 * ledger that activation now creates. Idempotent.
 *
 *   node dist/operator/personal-chains.js [--dry-run]
 *
 * New personal chains atomically enqueue ledger provisioning. The platform Worker
 * prepares the shared binding; the local simulator remains development-only.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { ensurePersonalChain } from '../modules/supply-chains/personal-chain.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}
const dryRun = process.argv.includes('--dry-run');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
try {
  // Farms, retailers and distributors without their own ledger, with the
  // owner of their enrollment (or their tier-1 account) as its manager.
  const orgs = await prisma.organization.findMany({
    where: {
      status: 'ACTIVE',
      capabilities: { some: { code: { in: ['FARM', 'RETAILER', 'DISTRIBUTOR'] }, revokedAt: null } },
      ownedChains: { none: { personal: true } },
    },
    select: { id: true, enterpriseEnrollment: { select: { ownerId: true } }, users: { where: { enterpriseTier: 1 }, select: { id: true }, take: 1 } },
  });
  const rows = orgs.flatMap((o) => {
    const ownerId = o.enterpriseEnrollment?.ownerId ?? o.users[0]?.id;
    return ownerId ? [{ organizationId: o.id, userId: ownerId }] : [];
  });
  const created: string[] = [];
  for (const row of rows) {
    if (dryRun) {
      created.push(row.organizationId);
      continue;
    }
    const result = await prisma.$transaction((tx) =>
      ensurePersonalChain(tx, {
        organizationId: row.organizationId,
        ownerId: row.userId,
      }),
    );
    if (result.created) created.push(result.chain.id);
  }
  console.log(JSON.stringify({ dryRun, count: created.length, ids: created }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
