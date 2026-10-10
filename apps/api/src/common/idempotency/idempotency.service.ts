import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { canonicalSha256 } from '../crypto/rfc8785.js';
import {
  IdempotencyStatus,
  type Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  authorizeCommand,
  type CommandActor,
} from './command-authorization.js';
import { commandContext, commandResponseJson } from './command-transaction.js';

export interface StartIdempotencyInput {
  idempotencyKey: string;
  requesterId: string;
  operation: string;
  requestType: string;
  payload: unknown;
  expiresInMinutes?: number;
  authorizationScope?: string;
  responseStatus?: number;
}

export type IdempotencyStartResult =
  | {
      type: 'NEW';
      recordId: string;
    }
  | {
      type: 'REPLAY';
      status: number;
      body: Prisma.JsonValue | null;
    };

@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** HTTP business commands must enter here, including device commands. */
  async executeCommand<T>(
    input: StartIdempotencyInput & { actor: CommandActor | null },
    command: () => Promise<T>,
  ): Promise<T | Prisma.JsonValue | null> {
    const scope = await authorizeCommand(this.prisma, input);
    return this.execute(
      { ...input, authorizationScope: scope },
      command,
      async () => {
        if ((await authorizeCommand(this.prisma, input)) !== scope)
          throw new ConflictException('Phạm vi command đã thay đổi');
      },
      input,
    );
  }

  async execute<T>(
    input: StartIdempotencyInput,
    command: () => Promise<T>,
    authorize?: () => Promise<void>,
    authorizedInput?: StartIdempotencyInput & { actor: CommandActor | null },
  ): Promise<T | Prisma.JsonValue | null> {
    const started = await this.start(input);
    if (started.type === 'REPLAY') {
      await authorize?.();
      if (started.status >= 400)
        throw new HttpException(
          (started.body as object) ?? { message: 'Thao tác thất bại' },
          started.status,
        );
      return started.body;
    }
    let result: T;
    try {
      if (authorizedInput && input.authorizationScope) {
        const context = {
          recordId: started.recordId,
          authorizationScope: input.authorizationScope,
          input: authorizedInput,
          responseStatus: input.responseStatus ?? 200,
          committed: false,
        };
        result = await commandContext.run(context, command);
        if (!context.committed)
          throw new Error('Business command did not commit its result journal');
      } else {
        result = await command();
      }
    } catch (error) {
      // Unknown infrastructure failures may have happened after commit.
      // Leave them PROCESSING for reconciliation instead of risking a replay.
      if (error instanceof HttpException) {
        await this.fail(started.recordId, error.getStatus(), {
          message: error.message,
        });
      }
      throw error;
    }
    const body = commandResponseJson(result);
    await this.complete(started.recordId, input.responseStatus ?? 200, body);
    return result;
  }

  async start(input: StartIdempotencyInput): Promise<IdempotencyStartResult> {
    if (
      typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey.trim() ||
      input.idempotencyKey.trim().length > 255
    ) {
      throw new ConflictException('Thiếu header Idempotency-Key');
    }

    const requestHash = this.createRequestHash(input.payload);
    const expiresAt = new Date(
      Date.now() + (input.expiresInMinutes ?? 24 * 60) * 60 * 1000,
    );

    try {
      const record = await this.prisma.idempotencyRecord.create({
        data: {
          idempotencyKey: input.idempotencyKey.trim(),
          requesterId: input.requesterId,
          operation: input.operation,
          requestType: input.requestType,
          requestHash,
          authorizationScope: input.authorizationScope,
          status: IdempotencyStatus.PROCESSING,
          expiresAt,
        },
      });

      return {
        type: 'NEW',
        recordId: record.id,
      };
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      return this.resolveExistingRecord({
        ...input,
        requestHash,
        expiresAt,
      });
    }
  }

  async complete(
    recordId: string,
    status: number,
    body: Prisma.InputJsonValue,
    resourceId?: string,
  ): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseStatus: status,
        responseBody: body,
        resourceId,
      },
    });
  }

  async fail(
    recordId: string,
    status: number,
    body: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        status: IdempotencyStatus.FAILED,
        responseStatus: status,
        responseBody: body,
      },
    });
  }

  private async resolveExistingRecord(
    input: StartIdempotencyInput & {
      requestHash: string;
      expiresAt: Date;
    },
  ): Promise<IdempotencyStartResult> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        requesterId_operation_idempotencyKey: {
          requesterId: input.requesterId,
          operation: input.operation,
          idempotencyKey: input.idempotencyKey.trim(),
        },
      },
    });

    if (!record) {
      throw new ConflictException('Không thể xử lý Idempotency-Key');
    }

    if (record.requestHash !== input.requestHash) {
      throw new ConflictException(
        'Idempotency-Key đã được dùng cho payload khác',
      );
    }

    if (
      input.authorizationScope &&
      record.authorizationScope !== input.authorizationScope
    ) {
      throw new ConflictException(
        'Idempotency-Key thuộc phạm vi khác hoặc bản ghi legacy cần đối soát',
      );
    }

    // A journal is positive evidence of the original business commit. Absence
    // of a journal never authorizes re-execution of an uncertain request.
    if (input.authorizationScope) {
      const committed = await this.prisma.commandCommit.findUnique({
        where: { idempotencyRecordId: record.id },
      });
      if (committed) {
        if (
          committed.authorizationScope !== input.authorizationScope ||
          committed.requesterId !== input.requesterId ||
          committed.operation !== input.operation
        )
          throw new ConflictException('Journal không khớp phạm vi command');
        return {
          type: 'REPLAY',
          status: committed.responseStatus,
          body: committed.responseBody,
        };
      }
    }

    if (
      (record.status === IdempotencyStatus.COMPLETED ||
        record.status === IdempotencyStatus.FAILED) &&
      record.responseStatus !== null
    ) {
      if (
        input.authorizationScope &&
        record.status === IdempotencyStatus.COMPLETED
      )
        throw new ConflictException(
          'Kết quả command thiếu journal; cần đối soát',
        );
      return {
        type: 'REPLAY',
        status: record.responseStatus,
        body: record.responseBody,
      };
    }

    if (record.expiresAt && record.expiresAt <= new Date()) {
      throw new ConflictException(
        'Expired in-progress request requires reconciliation before retry',
      );
    }

    throw new ConflictException(
      'Request với Idempotency-Key này đang được xử lý',
    );
  }

  private createRequestHash(payload: unknown): string {
    try {
      return canonicalSha256(payload);
    } catch {
      throw new ConflictException('Payload không thể tạo request hash');
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
