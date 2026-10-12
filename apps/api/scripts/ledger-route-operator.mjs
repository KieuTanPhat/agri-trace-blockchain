import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import {
  applyLedgerRouteImport,
  inventoryLedgerRoutes,
  registerLedgerRouteDefinition,
} from '../dist/modules/trace/ledger-route-import.js';

const [mode, inputPath, outputPath] = process.argv.slice(2);
let database;
try {
  if (
    !['inventory', 'register', 'apply'].includes(mode) ||
    !inputPath ||
    !isAbsolute(inputPath)
  )
    throw new Error('Requires mode and absolute input artifact path');
  const metadata = lstatSync(inputPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > 1024 * 1024
  )
    throw new Error('Requires bounded regular input artifact');
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const environment = process.env.LEDGER_ROUTE_OPERATOR_ENVIRONMENT;
  const sourceSha = process.env.APP_RELEASE_SHA;
  if (
    !['production', 'isolated'].includes(environment) ||
    !/^[a-f0-9]{40}$/.test(sourceSha ?? '')
  )
    throw new Error('Requires explicit operator environment and release SHA');
  const isolated = environment === 'isolated';
  if (
    isolated &&
    (process.env.HYBRID_DRAFT_TESTS !== '1' ||
      !process.env.TEST_DATABASE_URL ||
      process.env.NODE_ENV === 'production')
  )
    throw new Error('Requires isolated database opt-in');
  const connectionString = isolated
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error('Requires configured operator database');
  database = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const context = { environment, sourceSha };
  if (mode === 'inventory') {
    if (!outputPath || !isAbsolute(outputPath))
      throw new Error('Requires absolute exclusive inventory output path');
    const inventory = await database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return inventoryLedgerRoutes(tx, input);
      },
      { isolationLevel: 'RepeatableRead', timeout: 120000 },
    );
    writeFileSync(outputPath, JSON.stringify(inventory, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        result: 'read-only-inventory-created',
        digest: inventory.digest,
        events: inventory.entries.length,
      }),
    );
  } else {
    const result =
      mode === 'register'
        ? await registerLedgerRouteDefinition(database, input, context)
        : await applyLedgerRouteImport(database, input, context);
    console.log(JSON.stringify({ result: 'passed', ...result }));
  }
} catch {
  // Do not leak connection strings, SQL, private payloads or user paths to logs.
  console.error('Ledger route operator failed; inspect restricted diagnostics');
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
