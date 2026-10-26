/**
 * One-off backfill: gives every active organization whose owner holds
 * CREATE_CHAIN the personal chain that activation now creates. Idempotent.
 *
 *   node dist/operator/personal-chains.js [--dry-run]
 *
 * New personal chains still need a ledger binding (operator register-binding,
 * onboard and activate; the local simulator binds them on its own).
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
  const owners = await prisma.scopedRoleGrant.findMany({
    where: {
      scope: 'ORGANIZATION',
      role: 'CREATE_CHAIN',
      revokedAt: null,
      organization: {
        status: 'ACTIVE',
        ownedChains: { none: { personal: true } },
      },
    },
    select: { organizationId: true, userId: true },
  });
  // Only the tier-1 owner holds CREATE_CHAIN; keep one row per organization.
  const rows = [...new Map(owners.map((o) => [o.organizationId, o])).values()];
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
