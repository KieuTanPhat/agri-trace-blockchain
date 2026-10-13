import { Injectable, ServiceUnavailableException, type CallHandler,
  type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SESSION_AND_READ_POSTS = new Set([
  '/auth/login', '/auth/refresh', '/auth/logout', '/auth/logout-all',
  '/command-requests/status',
]);

/** Runs after authentication guards. The canary list grants no domain rights;
 * the normal current-session/scope checks still authorize every command. */
@Injectable()
export class MaintenanceWriteInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{
      method: string; originalUrl: string; user?: { sub?: string };
    }>();
    const method = request.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next.handle();
    const path = request.originalUrl.split('?')[0].replace(/^\/api(?=\/)/, '');
    if (method === 'POST' && SESSION_AND_READ_POSTS.has(path)) return next.handle();
    const configured = this.config.get<string>('HYBRID_WRITES_MODE');
    const mode = configured ?? (this.config.get<string>('NODE_ENV') === 'production' ? 'CLOSED' : 'OPEN');
    if (mode === 'OPEN') return next.handle();
    if (mode === 'CANARY') {
      const actors = (this.config.get<string>('HYBRID_CANARY_ACTOR_IDS') ?? '').split(',');
      if (actors.length <= 32 && actors.every(actor => UUID.test(actor)) &&
          request.user?.sub && actors.includes(request.user.sub)) return next.handle();
    }
    throw new ServiceUnavailableException('Hệ thống đang bảo trì, vui lòng thử lại sau.');
  }
}
