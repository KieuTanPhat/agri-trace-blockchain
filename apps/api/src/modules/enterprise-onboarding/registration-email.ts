import { randomInt } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * An address already used as an account login or as an enterprise contact.
 * Equality on lower(email), the expression behind ux_app_user_email_lower;
 * ILIKE would treat '_' and '%' in valid addresses as patterns.
 */
export async function registrationEmailInUse(db: Db, email: string) {
  const normalized = email.trim().toLowerCase();
  const [row] = await db.$queryRaw<{ used: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM app_user WHERE lower(email) = ${normalized})
        OR EXISTS(SELECT 1 FROM enterprise_profile WHERE lower(contact_email) = ${normalized})
      AS used
  `;
  return row.used;
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';

/** Temporary password mailed after signup; the owner must replace it at first sign-in. */
export function temporaryPassword(length = 16) {
  const all = LETTERS + DIGITS;
  const chars = [
    LETTERS[randomInt(LETTERS.length)],
    DIGITS[randomInt(DIGITS.length)],
    ...Array.from({ length: length - 2 }, () => all[randomInt(all.length)]),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
