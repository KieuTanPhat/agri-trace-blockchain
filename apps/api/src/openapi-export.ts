import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { createOpenApiDocument } from './common/api/openapi.js';

// The exporter never loads deployment secrets or starts a listener/worker.
process.env.OPENAPI_EXPORT = 'true';
process.env.DATABASE_URL = 'postgresql://localhost:1/openapi_export_only';
process.env.JWT_SECRET = 'openapi-export-placeholder-not-a-deployment-secret';
process.env.FABRIC_ENABLED = 'false';
const { AppModule } = await import('./app.module.js');
const output = process.argv[2];
if (!output) throw new Error('Usage: node openapi-export.js <output.json>');
const app = await NestFactory.create(AppModule, {
  logger: false,
  abortOnError: false,
});
try {
  app.setGlobalPrefix('api');
  const document = createOpenApiDocument(app);
  const path = resolve(output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(sorted(document), null, 2)}\n`,
    'utf8',
  );
} finally {
  await app.close();
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([key, item]) => [key, sorted(item)]),
    );
  return value;
}
