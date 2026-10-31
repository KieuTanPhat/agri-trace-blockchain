/** Bootstrap only the first admin of the named, operator-owned local UI-test DB. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, compare } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { appendPlatformAudit, lockPlatformAudit } from '../src/modules/platform-governance/platform-audit.js';

const target = 'agri_trace_ui_test';
assert.notEqual(process.env.NODE_ENV, 'production');
const url = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.port || '5432', '5432');
assert.equal(url.pathname, `/${target}`, 'Only the local UI-test DB is supported');
assert.ok(!url.searchParams.has('host'), 'Alternate socket host is not allowed');
assert.equal(process.env.CONFIRM_UI_TEST_DATABASE, target, 'Explicit confirmation required');
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ database: target, host: url.hostname, dryRun: true, writes: false }));
} else {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
  const userId = randomUUID(), email = 'ui.admin@example.test';
  const password = `Ui!${randomBytes(18).toString('base64url')}9a`;
  const credentialFile = resolve('../../.codex/ui-test-admin.json');
  const credential = { database: target, userId, email, password, mustChangePassword: true,
    status: 'PENDING', warning: 'Local UI-test only. Do not commit or share. Change password at first login.' };
  try {
    const passwordHash = await hash(password, 12);
    await db.$transaction(async (tx) => {
      await lockPlatformAudit(tx);
      const [identity] = await tx.$queryRaw<{ database: string; owns: boolean }[]>`
        SELECT current_database() AS database, pg_get_userbyid(datdba) = current_user AS owns
        FROM pg_database WHERE datname=current_database()`;
      assert.equal(identity?.database, target);
      assert.equal(identity?.owns, true);
      assert.equal(await tx.user.count(), 0, 'Refusing existing users; never resets passwords');
      const [state] = await tx.$queryRaw<{ unfinished: bigint; ready: bigint }[]>`
        SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS unfinished,
          count(*) FILTER (WHERE migration_name='20261222000000_external_processing_event_scope' AND finished_at IS NOT NULL) AS ready
        FROM _prisma_migrations`;
      assert.equal(Number(state.unfinished), 0);
      assert.equal(Number(state.ready), 1, 'Current migration is required');
      // Save before commit. If interrupted, reconcile this file/account rather
      // than reissuing credentials or overwriting an existing login.
      writeFileSync(credentialFile, JSON.stringify(credential, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      const role = await tx.role.upsert({ where: { code: 'SYSTEM_ADMIN' },
        create: { code: 'SYSTEM_ADMIN', name: 'Quản trị hệ thống' }, update: {} });
      await tx.user.create({ data: { id: userId, email, fullName: '[UI-TEST] Quản trị viên',
        roleId: role.id, organizationId: null, passwordHash, accountStatus: 'ACTIVE',
        mustChangePassword: true, passwordChangedAt: new Date() } });
      await appendPlatformAudit(tx, { actor: null, action: 'LOCAL_UI_ADMIN_BOOTSTRAPPED',
        subjectType: 'USER', subjectId: userId, reason: 'First admin in owned local UI-test DB',
        details: { database: target, firstLoginChangeRequired: true } });
    });
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
    assert.equal(stored.role.code, 'SYSTEM_ADMIN');
    assert.equal(stored.organizationId, null);
    assert.equal(stored.mustChangePassword, true);
    assert.ok(await compare(password, stored.passwordHash));
    credential.status = 'CREATED';
    writeFileSync(credentialFile, JSON.stringify(credential, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ database: target, email, role: stored.role.code,
      mustChangePassword: true, credentialFile, passwordVerified: true }));
  } finally { await db.$disconnect(); }
}
