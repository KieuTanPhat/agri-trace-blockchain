import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const header = request.headers['idempotency-key'];
    const value = Array.isArray(header) ? header[0] : header;

    return value?.trim() || undefined;
  },
);