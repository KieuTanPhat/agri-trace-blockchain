import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, type ErrorCodeValue } from '../constants/error-code.js';
import type { RequestWithId } from '../request/request-id.middleware.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId & Request>();

    const status = this.getStatus(exception);
    const message = this.getMessage(exception);
    const code = this.getErrorCode(exception, status);

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
      'code' in exception
    ) {
      if (exception.code === 'P2002') return HttpStatus.CONFLICT;
      if (exception.code === 'P2003') return HttpStatus.CONFLICT;
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
      if (exception.code === 'P2002' || exception.code === 'P2003') {
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
