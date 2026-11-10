import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context.js';

export type RequestWithId = Request & {
  requestId?: string;
};

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestIdMiddleware.name);

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const header = request.headers['x-request-id'];

    const requestId =
      typeof header === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(header)
        ? header
        : randomUUID();

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    const startedAt = Date.now();
    response.once('finish', () => {
      this.logger.log('HTTP request completed', {
        requestId,
        method: request.method,
        // URLs can contain reset tokens or personal query parameters.
        path: request.originalUrl.split('?')[0],
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    requestContext.run({ requestId }, () => next());
  }
}
