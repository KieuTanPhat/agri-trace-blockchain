import type { Prisma } from '../../generated/prisma/client.js';
import { openSecret, sealSecret } from '../../common/crypto/secret-box.js';
import { appendPlatformAudit, lockPlatformAudit } from './platform-audit.js';

/** Offline operator primitive. Call only while API and Worker are stopped.
 * The transaction verifies every old ciphertext before changing anything. */
export async function rotatePlatformSecrets(
  tx: Prisma.TransactionClient,
  oldKey: Buffer,
  newKey: Buffer,
  apply = false,
) {
  if (oldKey.equals(newKey)) throw new Error('NEW_KEY_EQUALS_OLD_KEY');
  await lockPlatformAudit(tx);
  const seeds = await tx.platformMfa.findMany();
  const tickets = await tx.platformPrivacyTicket.findMany();
  const events = await tx.platformPrivacyEvent.findMany();
  const rotate = (ciphertext: string, aad: string) => {
    const plaintext = openSecret(ciphertext, aad, oldKey);
    const next = sealSecret(plaintext, aad, newKey);
    if (openSecret(next, aad, newKey) !== plaintext)
      throw new Error('CIPHERTEXT_ROUND_TRIP_FAILED');
    return next;
  };
  const nextSeeds = seeds.map((row) => ({
    userId: row.userId,
    ciphertext: rotate(row.secretCiphertext, `platform-mfa:${row.userId}`),
  }));
  const nextTickets = tickets.map((row) => ({
    id: row.id,
    ciphertext: rotate(row.payloadCiphertext, `platform-privacy:${row.id}`),
  }));
  const nextEvents = events.map((row) => ({
    id: row.id,
    ciphertext: rotate(
      row.payloadCiphertext,
      `platform-privacy-event:${row.id}`,
    ),
  }));
  const result = {
    applied: apply,
    mfaSeeds: seeds.length,
    recoveryCodesInvalidated: seeds.reduce(
      (sum, row) =>
        sum +
        (Array.isArray(row.recoveryCodeHashes)
          ? row.recoveryCodeHashes.length
          : 0),
      0,
    ),
    privacyTickets: tickets.length,
    privacyEvents: events.length,
  };
  if (!apply) return result;
  await tx.$executeRaw`SELECT set_config('agritrace.platform_key_rotation', 'on', true)`;
  for (const row of nextSeeds)
    await tx.platformMfa.update({
      where: { userId: row.userId },
      data: { secretCiphertext: row.ciphertext, recoveryCodeHashes: [] },
    });
  for (const row of nextTickets)
    await tx.platformPrivacyTicket.update({
      where: { id: row.id },
      data: { payloadCiphertext: row.ciphertext },
    });
  for (const row of nextEvents)
    await tx.platformPrivacyEvent.update({
      where: { id: row.id },
      data: { payloadCiphertext: row.ciphertext },
    });
  await appendPlatformAudit(tx, {
    actor: null,
    action: 'PLATFORM_SECRET_ROTATED',
    subjectType: 'PLATFORM',
    subjectId: 'platform-secret-key',
    details: result,
  });
  return result;
}
