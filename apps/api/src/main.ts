import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiResponseInterceptor } from './common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from './common/exception/global-exception.filter.js';
import { createApplicationLogger } from './common/logging/app-logger.js';
import { createOpenApiDocument } from './common/api/openapi.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: createApplicationLogger(),
  });
  app.enableShutdownHooks();
  const trustProxyHops = process.env.TRUST_PROXY_HOPS;
  if (trustProxyHops !== undefined) {
    if (!/^[01]$/.test(trustProxyHops)) {
      throw new Error('TRUST_PROXY_HOPS must be 0 or 1');
    }
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', Number(trustProxyHops));
  }
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());

  SwaggerModule.setup('docs', app, createOpenApiDocument(app), {
    useGlobalPrefix: true,
  });
  await app.listen(process.env.PORT ?? 8080);
}
await bootstrap();
