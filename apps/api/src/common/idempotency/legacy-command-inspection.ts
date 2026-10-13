import { ConflictException, ForbiddenException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { authorizeCommand, type AuthorizedCommand } from './command-authorization.js';

type Journal = Prisma.CommandCommitGetPayload<object>;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Read-only bridge for the pre-A create body. The caller has already matched
 * requester/operation/key/original-body hash under the record lock. It never
 * adds a chain to that hash, changes a journal, or runs the original command. */
export async function legacyCreationInspection(
  tx: Prisma.TransactionClient,
  input: AuthorizedCommand,
  journal: Journal | null,
): Promise<{ scope: string; reconciliationRequired: boolean } | null> {
  const payload = object(input.payload);
  if (input.operation !== 'CREATE_PRODUCTION_CYCLE' || !payload || payload.chainId !== undefined)
    return null;
  if (!input.actor?.sub || !input.actor.organizationId)
    throw new ForbiddenException('Command yêu cầu quyền nghiệp vụ hiện hành');
  if (!journal) {
    // No proven resource means no response can be disclosed or execution
    // retried. A current actor with a valid farm grant may inspect only HOLD.
    const grant = await tx.scopedRoleGrant.findFirst({
      where: { userId: input.actor.sub, organizationId: input.actor.organizationId,
        scope: 'CHAIN', role: 'FARM_STAFF', revokedAt: null,
        chain: { businessProfile: { state: 'ACTIVE', scopeVersion: 1 },
          memberships: { some: { organizationId: input.actor.organizationId, status: 'ACTIVE' } } } },
      orderBy: { id: 'asc' },
    });
    if (!grant?.chainId) throw new ForbiddenException('Chưa có quyền nghiệp vụ trong chuỗi');
    const scope = await authorizeCommand(tx, { ...input, payload: { ...payload, chainId: grant.chainId } }, true);
    return { scope, reconciliationRequired: true };
  }
  if (journal.requesterId !== input.requesterId || journal.operation !== input.operation)
    throw new ConflictException('Journal không khớp phạm vi command');
  const resultIds = object(object(journal.resourceIds)?.result);
  const response = object(journal.responseBody);
  const candidates = [resultIds?.id, resultIds?.cycleId, response?.id, response?.cycleId]
    .filter((id): id is string => typeof id === 'string' && isUUID(id));
  const id = candidates[0];
  if (!id || candidates.some((candidate) => candidate !== id))
    throw new ConflictException('Journal không chứng minh đối tượng đã tạo');
  const cycle = await tx.productionCycle.findUnique({ where: { id } });
  if (!cycle?.chainId || cycle.farmOrgId !== input.actor.organizationId ||
      cycle.farmId !== payload.farmId || cycle.productId !== payload.productId ||
      (payload.plotId !== undefined && cycle.plotId !== payload.plotId))
    throw new ForbiddenException('Journal nằm ngoài phạm vi đối tượng gốc');
  // Existing-resource policy checks the current chain, accepted assignment,
  // capability, membership, grant, account and session under the normal locks.
  const scope = await authorizeCommand(tx, {
    ...input, operation: 'PLANT_PRODUCTION_CYCLE', payload: { cycleId: cycle.id },
  }, true);
  return { scope, reconciliationRequired: false };
}
