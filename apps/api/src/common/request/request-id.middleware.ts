import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type RequestWithId = Request & {
  requestId?: string;
};

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const header = request.headers['x-request-id'];

    const requestId =
      typeof header === 'string' && header.trim()
        ? header.trim()
        : randomUUID();

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    next();
  }
}
