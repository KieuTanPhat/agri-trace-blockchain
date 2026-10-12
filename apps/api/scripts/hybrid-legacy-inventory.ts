import { writeFileSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { inventoryLegacyScope } from '../src/modules/supply-chains/legacy-scope-inventory.js';
import { validateLegacyScopeManifest } from '../src/modules/supply-chains/legacy-scope-manifest.js';
import { preflightLegacyScope } from '../src/modules/supply-chains/legacy-scope-preflight.js';

const [mode, artifact, pin, sourceSha] = process.argv.slice(2);
let database: PrismaClient | undefined;
try {
  if (
    process.env.HYBRID_DRAFT_TESTS !== '1' ||
    !process.env.TEST_DATABASE_URL ||
    !['inventory', 'check'].includes(mode) ||
    !artifact ||
    !isAbsolute(artifact)
  )
    throw new Error(
      'Requires explicit isolated database opt-in, mode and absolute artifact path',
    );
  database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
  });
  let candidate: unknown;
  if (mode === 'check') {
    if (!pin || !sourceSha || statSync(artifact).size > 8 * 1024 * 1024)
      throw new Error('Requires independent pin, source and bounded manifest');
    candidate = JSON.parse(readFileSync(artifact, 'utf8'));
  }
  const snapshot = await database.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const inventory = await inventoryLegacyScope(tx);
      if (mode !== 'check') return { inventory };
      const checked = validateLegacyScopeManifest(candidate, inventory, pin!, {
        environment: 'isolated',
        sourceSha: sourceSha!,
      });
      const readiness = await preflightLegacyScope(tx, checked.manifest);
      return { inventory, checked, readiness };
    },
    { isolationLevel: 'RepeatableRead', timeout: 120000 },
  );
  const { inventory } = snapshot;
  if (mode === 'inventory') {
    writeFileSync(artifact, JSON.stringify(inventory, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        result: 'read-only-inventory-created',
        roots: inventory.roots.length,
        digest: inventory.digest,
      }),
    );
  } else {
    const result = snapshot.checked!;
    console.log(
      JSON.stringify({
        result: 'read-only-manifest-checked',
        digest: result.digest,
        mapped: result.mapped,
        unresolved: result.unresolved.length,
        activeUnresolved: result.activeUnresolved.length,
        cutoverReady: false,
        reason:
          'Apply/provenance/assignment/journal/rehearsal gates are separate',
      }),
    );
  }
} catch (error) {
  const message =
    error instanceof Error &&
    (error.message.startsWith('Legacy scope manifest rejected:') ||
      error.message.startsWith('Requires'))
      ? error.message
      : 'Legacy inventory/check failed; inspect restricted diagnostics';
  console.error(message);
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
