import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiResponseInterceptor } from './common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from './common/exception/global-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Agri Trace API')
    .setDescription(
      'Command API for agricultural production, lots, shipments and blockchain proofs',
    )
    .setVersion('2.0.0')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', name: 'Idempotency-Key', in: 'header' },
      'idempotency',
    )
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
    {
      useGlobalPrefix: true,
    },
  );
  await app.listen(process.env.PORT ?? 8080);
}
await bootstrap();
