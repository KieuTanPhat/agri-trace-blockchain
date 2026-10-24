import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { PrismaClient } from '../generated/prisma/client.js';
import { platformSecretKey } from '../common/crypto/secret-box.js';
import { rotatePlatformSecrets } from '../modules/platform-governance/platform-secret-rotation.js';

function keyFile(path: string | undefined) {
  if (!path || !isAbsolute(path)) throw new Error('KEY_FILE_MUST_BE_ABSOLUTE');
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 256 ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  )
    throw new Error('KEY_FILE_MUST_BE_PRIVATE_REGULAR_FILE');
  return platformSecretKey(readFileSync(path, 'utf8'));
}

let db: PrismaClient | undefined;
try {
  const args = process.argv.slice(2);
  const allowed = new Set([
    '--old-key-file',
    '--new-key-file',
    '--apply',
    '--services-stopped',
    '--invalidate-recovery-codes',
  ]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag) || options.has(flag))
      throw new Error('INVALID_ARGUMENTS');
    const value = flag.endsWith('-file') ? args[++i] : 'true';
    if (!value || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    options.set(flag, value);
  }
  const apply = options.has('--apply');
  if (
    apply &&
    !(
      options.has('--services-stopped') &&
      options.has('--invalidate-recovery-codes')
    )
  )
    throw new Error('APPLY_REQUIRES_SERVICES_STOPPED_AND_RECOVERY_ACK');
  const oldKey = keyFile(options.get('--old-key-file'));
  const newKey = keyFile(options.get('--new-key-file'));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const result = await db.$transaction(
    (tx) => rotatePlatformSecrets(tx, oldKey, newKey, apply),
    { timeout: 120_000, maxWait: 10_000 },
  );
  oldKey.fill(0);
  newKey.fill(0);
  console.log(JSON.stringify(result));
} catch {
  // Driver/crypto errors can contain private values. Do not print them.
  console.error(
    'Platform key rotation failed. Keep services stopped and preserve both keys. Check private key files, migration state and acknowledgement flags; reconcile a possible unknown COMMIT outcome before changing configuration.',
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
