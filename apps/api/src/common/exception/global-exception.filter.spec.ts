import { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter.js';

describe('Database exception mapping', () => {
  it.each([
    [{ code: 'P2034' }, 409, 'CONFLICT'],
    [
      {
        name: 'DriverAdapterError',
        cause: { kind: 'TransactionWriteConflict', originalCode: '40001' },
      },
      409,
      'CONFLICT',
    ],
    [{ code: 'P2004' }, 422, 'DATABASE_CONSTRAINT'],
    [new Error('private database credentials'), 500, 'INTERNAL_ERROR'],
  ])('maps %j without exposing database details', (error, status, code) => {
    const response = { status: vi.fn(), json: vi.fn() };
    response.status.mockReturnValue(response);
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ originalUrl: '/api/test' }),
      }),
    } as unknown as ArgumentsHost;
    new GlobalExceptionFilter().catch(error, host);
    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code }),
      }),
    );
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(
      'private database credentials',
    );
  });
});
