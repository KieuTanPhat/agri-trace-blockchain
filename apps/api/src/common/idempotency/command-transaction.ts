import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  authorizeCommand,
  type AuthorizedCommand,
} from './command-authorization.js';
import {
  isAuditedCommand,
  lockPlatformAudit,
} from '../../modules/platform-governance/platform-audit.js';

export interface CommandContext {
  recordId: string;
  authorizationScope: string;
  input: AuthorizedCommand;
  responseStatus: number;
  committed: boolean;
}

export const commandContext = new AsyncLocalStorage<CommandContext>();

export function effectiveCommandActor<
  T extends { sub: string | null; role: string; organizationId: string | null },
>(actor: T): T {
  const business = commandContext.getStore()?.input.businessActor;
  if (!business) return actor;
  if (
    business.sub !== actor.sub ||
    business.organizationId !== actor.organizationId
  )
    throw new Error('Derived command actor identity mismatch');
  return { ...actor, role: business.role };
}

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

/** A Prisma request error thrown by a statement inside the transaction
 * callback means COMMIT was never sent, so the domain writes and journal were
 * rolled back. Such constraint errors are terminal business rejections; any
 * other failure (including one at COMMIT) keeps its unknown-outcome path. */
export function rolledBackCommandError(error: unknown): unknown {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error instanceof HttpException
  )
    return error;
  switch (error.code) {
    case 'P2002':
      return new ConflictException('Dữ liệu đã tồn tại (trùng khóa duy nhất)');
    case 'P2003':
      return new ConflictException('Dữ liệu liên quan không hợp lệ');
    case 'P2025':
      return new NotFoundException('Không tìm thấy dữ liệu cần cập nhật');
    case 'P2004':
      return new UnprocessableEntityException(
        'Dữ liệu vi phạm ràng buộc cơ sở dữ liệu',
      );
    default:
      return error;
  }
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
      // Before authorizeCommand's actor/org share locks: see lockPlatformAudit.
      if (
        isAuditedCommand(context.input.operation, context.input.actor?.role)
      )
        await lockPlatformAudit(tx);
      const scope = await authorizeCommand(tx, context.input, true);
      if (
        scope !== context.authorizationScope ||
        record.authorizationScope !== scope
      )
        throw new ConflictException('Phạm vi command đã thay đổi');
    }
    let response: T;
    try {
      response = await command(tx);
    } catch (error) {
      throw rolledBackCommandError(error);
    }
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
            role:
              context.input.businessActor?.role ??
              context.input.actor?.role ??
              'IOT_DEVICE',
            organizationId: context.input.actor?.organizationId ?? null,
            ...(context.input.businessActor
              ? { authenticatedRole: context.input.actor!.role }
              : {}),
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
