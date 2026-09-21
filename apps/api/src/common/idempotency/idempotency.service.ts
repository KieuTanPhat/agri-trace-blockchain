import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { canonicalSha256 } from '../crypto/rfc8785.js';
import {
  IdempotencyStatus,
  type Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface StartIdempotencyInput {
  idempotencyKey: string;
  requesterId: string;
  operation: string;
  requestType: string;
  payload: unknown;
  expiresInMinutes?: number;
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

  async execute<T>(
    input: StartIdempotencyInput,
    command: () => Promise<T>,
  ): Promise<T | Prisma.JsonValue | null> {
    const started = await this.start(input);
    if (started.type === 'REPLAY') return started.body;
    try {
      const result = await command();
      const body = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      await this.complete(started.recordId, 200, body);
      return result;
    } catch (error) {
      await this.fail(started.recordId, 500, {
        message: error instanceof Error ? error.message : 'Command failed',
      });
      throw error;
    }
  }

  async start(input: StartIdempotencyInput): Promise<IdempotencyStartResult> {
    if (!input.idempotencyKey?.trim()) {
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
      (record.status === IdempotencyStatus.COMPLETED ||
        record.status === IdempotencyStatus.FAILED) &&
      record.responseStatus !== null
    ) {
      return {
        type: 'REPLAY',
        status: record.responseStatus,
        body: record.responseBody,
      };
    }

    if (record.expiresAt && record.expiresAt <= new Date()) {
      const restarted = await this.prisma.idempotencyRecord.update({
        where: { id: record.id },
        data: {
          requestHash: input.requestHash,
          requestType: input.requestType,
          status: IdempotencyStatus.PROCESSING,
          responseStatus: null,
          responseBody: undefined,
          resourceId: null,
          expiresAt: input.expiresAt,
        },
      });

      return {
        type: 'NEW',
        recordId: restarted.id,
      };
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
