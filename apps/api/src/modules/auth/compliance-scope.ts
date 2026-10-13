import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Actor } from '../trace/trace.service.js';
import { commandContext } from '../../common/idempotency/command-transaction.js';

export async function assertAssignedFarm(
  db: Prisma.TransactionClient,
  actor: Pick<Actor, 'sub' | 'role'>,
  farmId: string,
  lock = false,
): Promise<string> {
  if (actor.role !== 'COMPLIANCE_REVIEWER' || !actor.sub)
    throw new ForbiddenException('Cần reviewer được phân công');
  const scoped = commandContext.getStore()?.input.businessActor;
  const scopedReviewer =
    scoped?.sub === actor.sub && scoped.role === 'COMPLIANCE_REVIEWER';
  if (lock) {
    await db.$queryRaw`SELECT assignment_id FROM compliance_assignment
      WHERE reviewer_user_id = ${actor.sub}::uuid AND farm_id = ${farmId}::uuid AND revoked_at IS NULL FOR SHARE`;
  }
  const assigned = await db.complianceAssignment.findFirst({
    where: {
      reviewerUserId: actor.sub,
      farmId,
      revokedAt: null,
      reviewer: {
        accountStatus: 'ACTIVE',
        ...(scopedReviewer
          ? {
              organization: {
                status: 'ACTIVE' as const,
                capabilities: {
                  some: { code: 'AUDITOR' as const, revokedAt: null },
                },
              },
            }
          : {
              role: { code: 'COMPLIANCE_REVIEWER' },
              organization: { type: 'AUDITOR', status: 'ACTIVE' },
            }),
      },
    },
    select: { id: true },
  });
  if (!assigned)
    throw new ForbiddenException(
      'Reviewer chưa được phân công nông trại này hoặc đã bị thu hồi',
    );
  return assigned.id;
}
