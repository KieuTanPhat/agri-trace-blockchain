import type { Prisma } from '../../generated/prisma/client.js';

type Db = Pick<Prisma.TransactionClient, 'enterpriseEnrollment'>;

/** Match the canonical form stored by registration before checking uniqueness. */
export function normalizeRegistrationBusinessId(
  businessId: string | null | undefined,
) {
  return businessId?.trim().replace('-', '') || null;
}

export async function registrationBusinessIdInUse(
  db: Db,
  businessId: string,
) {
  return Boolean(
    await db.enterpriseEnrollment.findUnique({
      where: { businessId },
      select: { id: true },
    }),
  );
}
