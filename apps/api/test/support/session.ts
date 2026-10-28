import { randomUUID } from 'node:crypto';

/** A new refresh session starts its own family, as login does. */
export function newSessionIds() {
  const id = randomUUID();
  return { id, familyId: id };
}
