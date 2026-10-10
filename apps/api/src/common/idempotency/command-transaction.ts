import { AsyncLocalStorage } from 'node:async_hooks';
import { ConflictException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  authorizeCommand,
  type AuthorizedCommand,
} from './command-authorization.js';

export interface CommandContext {
  recordId: string;
  authorizationScope: string;
  input: AuthorizedCommand;
  responseStatus: number;
  committed: boolean;
}

export const commandContext = new AsyncLocalStorage<CommandContext>();

export function commandResponseJson(value: unknown): Prisma.InputJsonValue {
  // Mirrors HTTP serialization for Date/Decimal, with lossless bigint strings.
  const encoded = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
  if (encoded === undefined)
    throw new Error('Command response cannot be serialized');
  return JSON.parse(encoded) as Prisma.InputJsonValue;
}

function resourceIds(value: unknown, path = ''): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const itemPath = path ? `${path}.${key}` : key;
    if (
      typeof item === 'string' &&
      (key === 'id' || key.endsWith('Id')) &&
      isUUID(item)
    )
      result[itemPath] = item;
    else if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      path.split('.').length < 4
    )
      Object.assign(result, resourceIds(item, itemPath));
  }
  return result;
}

/** A command's result and its domain writes share one PostgreSQL commit.
 * No network/Fabric calls belong in this transaction. */
export async function commandTransaction<T>(
  prisma: PrismaService,
  command: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    isolationLevel?: Prisma.TransactionIsolationLevel;
    maxWait?: number;
    timeout?: number;
  },
): Promise<T> {
  const context = commandContext.getStore();
  if (context?.committed)
    throw new Error('A command may commit only one domain transaction');
  const result = await prisma.$transaction(async (tx) => {
    if (context) {
      await tx.$queryRaw`SELECT idempotency_record_id FROM idempotency_record WHERE idempotency_record_id = ${context.recordId}::uuid FOR UPDATE`;
      const record = await tx.idempotencyRecord.findUniqueOrThrow({
        where: { id: context.recordId },
      });
      if (
        record.status !== 'PROCESSING' ||
        (await tx.commandCommit.findUnique({
          where: { idempotencyRecordId: record.id },
        }))
      )
        throw new ConflictException(
          'Command đã có kết quả; cần replay hoặc đối soát',
        );
      const scope = await authorizeCommand(tx, context.input, true);
      if (
        scope !== context.authorizationScope ||
        record.authorizationScope !== scope
      )
        throw new ConflictException('Phạm vi command đã thay đổi');
    }
    const response = await command(tx);
    if (context) {
      const body = commandResponseJson(response);
      await tx.commandCommit.create({
        data: {
          idempotencyRecordId: context.recordId,
          requesterId: context.input.requesterId,
          operation: context.input.operation,
          authorizationScope: context.authorizationScope,
          actorScope: {
            requesterId: context.input.requesterId,
            role: context.input.actor?.role ?? 'IOT_DEVICE',
            organizationId: context.input.actor?.organizationId ?? null,
          },
          resourceIds: {
            requested: resourceIds(context.input.payload),
            result: resourceIds(body),
          },
          responseStatus: context.responseStatus,
          responseBody: body ?? Prisma.JsonNull,
        },
      });
    }
    return response;
  }, options);
  if (context) context.committed = true;
  return result;
}

/** Use the same aggregate lock for every cycle mutation and every Lot /
 * Shipment mutation, before reading state or quantity. */
export async function lockAggregate(
  tx: Prisma.TransactionClient,
  kind: 'cycle' | 'lot',
  id: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`business:${kind}:${id}`}, 0))`;
}
