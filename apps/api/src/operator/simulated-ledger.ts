/**
 * Development, test and CI rehearsal only. Gives every chain without a binding
 * an ACTIVE simulated binding and confirms requested ledger grants, so the
 * single B write path works where no Fabric network runs. Events stay PENDING.
 *
 *   LEDGER_SIMULATION=1 node dist/operator/simulated-ledger.js [--watch <ms>]
 *
 * Refuses to run unless LEDGER_SIMULATION=1, and refuses any database that
 * already holds a real binding. Production never sets the variable.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { simulateLedger } from '../modules/ledger/simulated-ledger.js';

if (process.env.LEDGER_SIMULATION !== '1') {
  console.error('LEDGER_SIMULATION=1 is required; never run this in production');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}
const watch = process.argv[2] === '--watch' ? Number(process.argv[3]) : 0;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
const once = () => prisma.$transaction((tx) => simulateLedger(tx));
try {
  do {
    const result = await once();
    if (
      !watch ||
      result.boundChains ||
      result.requestedGrants ||
      result.confirmedPermissions
    )
      console.log(JSON.stringify(result));
    if (watch > 0) await new Promise((resolve) => setTimeout(resolve, watch));
  } while (watch > 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
