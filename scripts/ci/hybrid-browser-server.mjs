import "reflect-metadata";
import assert from "node:assert/strict";
import http from "node:http";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "../../apps/api/dist/app.module.js";
import { ApiResponseInterceptor } from "../../apps/api/dist/common/api/api-response.interceptor.js";
import { GlobalExceptionFilter } from "../../apps/api/dist/common/exception/global-exception.filter.js";

assert.equal(process.env.HYBRID_BROWSER_TESTS, "1");
assert.match(process.env.DATABASE_URL, /@127\.0\.0\.1:25489\/browser_test$/);
assert.equal(process.env.FABRIC_ENABLED, "false");
const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix("api");
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
app.useGlobalFilters(new GlobalExceptionFilter());
app.useGlobalInterceptors(new ApiResponseInterceptor());
await app.listen(25602, "127.0.0.1");
const proxy = http.createServer((request, response) => {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: request.url.startsWith("/api/") ? 25602 : 25601,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (reply) => {
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on("error", () => {
    response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});
await new Promise((resolve) => proxy.listen(25600, "127.0.0.1", resolve));
console.log("isolated-browser-api-and-proxy-ready");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    proxy.close();
    await app.close();
    process.exit(0);
  });
