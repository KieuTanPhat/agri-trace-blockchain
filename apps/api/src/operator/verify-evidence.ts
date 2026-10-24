/**
 * Re-verifies every stored trace event from the database alone: pinned route,
 * stored proof, version-dispatched private hash (release B and the release-C
 * organization signatures) and sensor evidence. Use it after a restore:
 *
 *   DATABASE_URL=<restored copy> node dist/operator/verify-evidence.js [--chain <uuid>]
 *
 * Exits 1 when any event fails. It never writes.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { verifyStoredEvidence } from '../modules/trace/event-evidence.js';

const url = process.env.DATABASE_URL;
if (process.argv.includes('--help')) {
  console.log('Usage: node dist/operator/verify-evidence.js [--chain <uuid>] (reads DATABASE_URL)');
  process.exit(0);
}
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}
const chain = process.argv[2] === '--chain' ? process.argv[3] : undefined;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
try {
  const report = await verifyStoredEvidence(prisma, {
    where: chain ? { chainContext: { chainId: chain } } : undefined,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failed.length ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
