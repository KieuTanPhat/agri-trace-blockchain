/**
 * One-off repair: chains created before owners received the business roles of
 * their own stages. For every non-personal chain, the users holding its
 * CHAIN_MANAGER grant for the owner organization receive the missing stage
 * roles (ensureOwnerStageRoles). Idempotent; each grant is audited and queued
 * for ledger confirmation by the Worker.
 *
 *   node dist/operator/owner-stage-roles.js [--dry-run]
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { ensureOwnerStageRoles, modelStages } from '../modules/supply-chains/owner-stage-roles.js';

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
  const managers = await prisma.scopedRoleGrant.findMany({
    where: { scope: 'CHAIN', role: 'CHAIN_MANAGER', revokedAt: null, chain: { personal: false } },
    select: { userId: true, organizationId: true, chain: { select: { id: true, name: true, ownerOrganizationId: true, supplyModel: true } } },
  });
  const report: { chainId: string; chain: string; userId: string; roles: string[] }[] = [];
  for (const m of managers) {
    const chain = m.chain;
    if (!chain || m.organizationId !== chain.ownerOrganizationId) continue;
    if (dryRun) {
      const stages = modelStages(chain.supplyModel, chain.ownerOrganizationId);
      const held = await prisma.scopedRoleGrant.findMany({
        where: { chainId: chain.id, userId: m.userId, scope: 'CHAIN', revokedAt: null },
        select: { role: true },
      });
      report.push({ chainId: chain.id, chain: chain.name, userId: m.userId, roles: stages.filter((s) => !held.some((h) => h.role === s || (s === 'FARM' && h.role === 'FARM_STAFF'))) });
      continue;
    }
    const roles = await prisma.$transaction((tx) => ensureOwnerStageRoles(tx, chain, m.userId));
    if (roles.length) report.push({ chainId: chain.id, chain: chain.name, userId: m.userId, roles });
  }
  console.log(JSON.stringify({ dryRun, count: report.length, chains: report.filter((r) => r.roles.length) }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
