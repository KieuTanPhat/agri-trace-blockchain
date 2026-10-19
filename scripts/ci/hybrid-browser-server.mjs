import 'reflect-metadata';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../apps/api/dist/app.module.js';
import { WorkerModule } from '../../apps/api/dist/worker/worker.module.js';
import { ApiResponseInterceptor } from '../../apps/api/dist/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../../apps/api/dist/common/exception/global-exception.filter.js';

assert.equal(process.env.HYBRID_BROWSER_TESTS, '1');
assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/hybrid');
const worker = process.argv.includes('--worker');
const app = await NestFactory.create(worker ? WorkerModule : AppModule, { logger: false });
if (!worker) {
  // One hop, as in production: the proxy below forwards the client address supplied by the browser context.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
}
await app.listen(0, '127.0.0.1');
const address = app.getHttpServer().address();
let proxy;
if (!worker) {
  proxy = http.createServer(async (request, response) => {
    // Delay real script delivery in the test proxy, without Playwright routes
    // racing trace snapshots or navigation. HTML and API requests stay immediate.
    const scriptDelay = Number(request.headers['x-agritrace-hydration-delay-ms']);
    const pathname = request.url.split('?')[0];
    if (pathname.startsWith('/_next/static/') && pathname.endsWith('.js') &&
      Number.isInteger(scriptDelay) && scriptDelay > 0 && scriptDelay <= 5000)
      await delay(scriptDelay);
    const headers = { ...request.headers };
    delete headers['x-agritrace-hydration-delay-ms'];
    if (request.url.split('?')[0] === '/api/auth/login') {
      const started = Date.now();
      response.on('finish', () => console.log(JSON.stringify({
        method: request.method, path: '/api/auth/login', status: response.statusCode,
        elapsedMs: Date.now() - started, clientAddress: request.headers['x-forwarded-for'],
      })));
    }
    const upstream = http.request({ host: '127.0.0.1', port: request.url.startsWith('/api/') ? address.port : Number(process.env.HYBRID_WEB_PORT),
      path: request.url, method: request.method, headers }, reply => {
      response.writeHead(reply.statusCode, reply.headers); reply.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
}
const origin = `http://127.0.0.1:${proxy ? proxy.address().port : address.port}`;
// The auth controller trusts only CORS_ORIGIN and reads it per request; the browser origin is a dynamic port.
if (proxy) process.env.CORS_ORIGIN = origin;
process.send?.({ ready: true, origin });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await new Promise(resolve => proxy ? proxy.close(resolve) : resolve());
  await app.close(); process.exit(0);
});
