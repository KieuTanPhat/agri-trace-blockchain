import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type RequestWithId = Request & {
  requestId?: string;
};

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestIdMiddleware.name);

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const header = request.headers['x-request-id'];

    const requestId =
      typeof header === 'string' && header.trim()
        ? header.trim()
        : randomUUID();

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    const startedAt = Date.now();
    response.once('finish', () => {
      this.logger.log('HTTP request completed', {
        requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  }
}
