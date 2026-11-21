import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, type ErrorCodeValue } from '../constants/error-code.js';
import type { RequestWithId } from '../request/request-id.middleware.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId & Request>();

    const status = this.getStatus(exception);
    const message = this.getMessage(exception);
    const code = this.getErrorCode(exception, status);
    if (status >= 500) {
      const error = exception as { code?: unknown; name?: unknown } | null;
      const route: unknown = request.route?.path;
      // Prisma messages/metadata can contain SQL, credentials and user data.
      // Keep only bounded identifiers so private diagnostics survive rollback.
      this.logger.error('Unhandled HTTP request failure', {
        requestId: request.requestId,
        method: request.method,
        path: typeof route === 'string' ? route : '[unmatched]',
        statusCode: status,
        errorType:
          typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error.name)
            ? error.name
            : 'UnknownError',
        ...(typeof error?.code === 'string' && /^P\d{4}$/.test(error.code)
          ? { prismaCode: error.code }
          : {}),
      });
    }
    if (status === 429 && exception instanceof HttpException) {
      const body = exception.getResponse();
      if (
        typeof body === 'object' &&
        body &&
        'retryAfterSeconds' in body &&
        typeof body.retryAfterSeconds === 'number' &&
        Number.isInteger(body.retryAfterSeconds) &&
        body.retryAfterSeconds > 0 &&
        body.retryAfterSeconds <= 3600
      )
        response.setHeader('Retry-After', String(body.retryAfterSeconds));
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
      },
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      requestId: request.requestId,
    });
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (
      typeof exception === 'object' &&
      exception !== null &&
      'cause' in exception &&
      typeof exception.cause === 'object' &&
      exception.cause !== null &&
      'kind' in exception.cause &&
      exception.cause.kind === 'TransactionWriteConflict'
    ) {
      return HttpStatus.CONFLICT;
    }

    if (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception
    ) {
      if (exception.code === 'P2002') return HttpStatus.CONFLICT;
      if (exception.code === 'P2003') return HttpStatus.CONFLICT;
      if (exception.code === 'P2034') return HttpStatus.CONFLICT;
      if (exception.code === 'P2025') return HttpStatus.NOT_FOUND;
      if (exception.code === 'P2004') {
        return HttpStatus.UNPROCESSABLE_ENTITY;
      }
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getMessage(exception: unknown): string | string[] {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return body;
      }

      if (typeof body === 'object' && body !== null && 'message' in body) {
        const message = body.message;

        if (typeof message === 'string' || Array.isArray(message)) {
          return message;
        }
      }
    }

    return 'Đã xảy ra lỗi không xác định';
  }

  private getErrorCode(exception: unknown, status: number): ErrorCodeValue {
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception
    ) {
      if (
        exception.code === 'P2002' ||
        exception.code === 'P2003' ||
        exception.code === 'P2034'
      ) {
        return ErrorCode.CONFLICT;
      }

      if (exception.code === 'P2025') {
        return ErrorCode.NOT_FOUND;
      }

      if (exception.code === 'P2004') {
        return ErrorCode.DATABASE_CONSTRAINT;
      }
    }

    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.UNPROCESSABLE_ENTITY;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
