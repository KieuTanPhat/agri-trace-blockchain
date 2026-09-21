import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module.js';
import { createApplicationLogger } from './common/logging/app-logger.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule, {
    logger: createApplicationLogger(),
  });
  app.enableShutdownHooks();
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 8081);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Blockchain worker health server listening on ${port}`, 'Bootstrap');
}

await bootstrap();
