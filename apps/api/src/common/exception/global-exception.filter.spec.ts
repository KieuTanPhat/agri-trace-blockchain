import { ArgumentsHost, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter.js';

describe('Database exception mapping', () => {
  beforeEach(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('logs the request and Prisma code without SQL, payload or credentials', () => {
    const privateData = 'private-sql-password-and-payload';
    const response = { status: vi.fn(), json: vi.fn() };
    response.status.mockReturnValue(response);
    const host = { switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ requestId: 'request-1', method: 'POST', route: { path: '/api/production-cycles/:id' }, path: '/api/production-cycles/private-resource', originalUrl: '/api/production-cycles/private-resource' }),
    }) } as unknown as ArgumentsHost;
    new GlobalExceptionFilter().catch(Object.assign(new Error(privateData), {
      name: 'PrismaClientKnownRequestError', code: 'P2028', meta: { query: privateData },
    }), host);
    expect(Logger.prototype.error).toHaveBeenCalledWith('Unhandled HTTP request failure', {
      requestId: 'request-1', method: 'POST', path: '/api/production-cycles/:id', statusCode: 500,
      errorType: 'PrismaClientKnownRequestError', prismaCode: 'P2028',
    });
    expect(JSON.stringify(vi.mocked(Logger.prototype.error).mock.calls)).not.toContain(privateData);
    expect(JSON.stringify(vi.mocked(Logger.prototype.error).mock.calls)).not.toContain('private-resource');
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('P2028');
  });

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
