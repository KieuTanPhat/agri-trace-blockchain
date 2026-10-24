import type { Prisma } from '../../generated/prisma/client.js';

/** Machine identities never sign in with a human password. */
const EXEMPT_ROLES = ['IOT_DEVICE', 'SYSTEM_ACTOR'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Maximum password age; PASSWORD_MAX_AGE_DAYS=0 disables rotation. */
export function passwordMaxAgeDays() {
  const days = Number(process.env.PASSWORD_MAX_AGE_DAYS ?? 30);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/** Accounts that never changed their password age from creation. */
export function passwordExpired(
  user: {
    passwordChangedAt?: Date | null;
    createdAt?: Date | null;
    role: { code: string };
  },
  now = Date.now(),
) {
  const days = passwordMaxAgeDays();
  const since = user.passwordChangedAt ?? user.createdAt;
  if (!days || !since || EXEMPT_ROLES.includes(user.role.code)) return false;
  return since.getTime() + days * DAY_MS <= now;
}

/**
 * Turns an expired password into a forced change, so the existing
 * mustChangePassword gate (guard, login response, web redirect) applies.
 * Writes only when the snapshot is already expired.
 */
export async function enforcePasswordAge(
  db: Pick<Prisma.TransactionClient, 'user'>,
  user: Parameters<typeof passwordExpired>[0] & {
    id: string;
    mustChangePassword: boolean;
  },
) {
  if (user.mustChangePassword || !passwordExpired(user)) return false;
  await db.user.updateMany({
    where: { id: user.id, mustChangePassword: false },
    data: { mustChangePassword: true },
  });
  return true;
}
