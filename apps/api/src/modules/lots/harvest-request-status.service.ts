import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  authorizeCommand,
  type CommandActor,
} from '../../common/idempotency/command-authorization.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { HarvestRequestStatusDto } from './harvest-request-status.dto.js';

function object(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

@Injectable()
export class HarvestRequestStatusService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(
    cycleId: string,
    key: string,
    actor: CommandActor,
  ): Promise<HarvestRequestStatusDto> {
    if (typeof key !== 'string' || !key.trim() || key.trim().length > 255)
      throw new BadRequestException('Thiếu header Idempotency-Key hợp lệ');
    const input = {
      requesterId: actor.sub!,
      operation: 'RECORD_HARVEST',
      payload: { cycleId },
      actor,
    };
    // A coherent snapshot and account/org locks prevent reading a result with
    // stale permissions. Lifecycle changes do not invalidate a genuine replay.
    return this.prisma.$transaction(
      async (tx) => {
        const scope = await authorizeCommand(tx, input, true);
        const record = await tx.idempotencyRecord.findUnique({
          where: {
            requesterId_operation_idempotencyKey: {
              requesterId: input.requesterId,
              operation: input.operation,
              idempotencyKey: key.trim(),
            },
          },
          include: { commandCommit: true },
        });
        if (!record) return { status: 'NOT_FOUND' };
        const unknown = { status: 'NEEDS_RECONCILIATION' } as const;
        if (
          record.authorizationScope !== scope ||
          record.requestType !== 'COMMAND'
        )
          return unknown;
        const journal = record.commandCommit;
        if (journal) {
          if (
            journal.requesterId !== input.requesterId ||
            journal.operation !== input.operation ||
            journal.authorizationScope !== scope ||
            journal.responseStatus !== 201
          )
            return unknown;
          const requested = object(object(journal.resourceIds).requested);
          const body = object(journal.responseBody);
          const harvest = object(body.harvest),
            lot = object(body.lot),
            qr = object(body.traceQr);
          if (
            requested.cycleId !== cycleId ||
            harvest.cycleId !== cycleId ||
            typeof harvest.id !== 'string' ||
            !isUUID(harvest.id) ||
            lot.harvestId !== harvest.id ||
            lot.farmOrgId !== actor.organizationId ||
            typeof lot.id !== 'string' ||
            !isUUID(lot.id) ||
            qr.lotId !== lot.id ||
            typeof lot.lotCode !== 'string' ||
            !lot.lotCode ||
            typeof qr.traceToken !== 'string' ||
            !qr.traceToken
          )
            return unknown;
          return {
            status: 'COMMITTED',
            result: {
              lot: { id: lot.id, lotCode: lot.lotCode },
              traceQr: { traceToken: qr.traceToken },
            },
          };
        }
        // Terminal business errors are persisted only after the command throws.
        // Neither a missing/expired journal nor a cached success proves rollback.
        if (
          record.status === 'FAILED' &&
          record.responseStatus !== null &&
          record.responseStatus >= 400 &&
          record.responseStatus < 500
        )
          return { status: 'REJECTED' };
        return unknown;
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
