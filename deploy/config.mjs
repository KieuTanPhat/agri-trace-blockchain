import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { parse } from 'dotenv';

export const POSTGRES_IMAGE = 'postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
export const CADDY_IMAGE = 'caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f';

export function validateConfig(config) {
  const origin = new URL(config.PUBLIC_ORIGIN);
  if (origin.protocol !== 'http:' || isIP(origin.hostname) !== 4 || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash || config.PUBLIC_ORIGIN.endsWith('/')) {
    throw new Error('PUBLIC_ORIGIN must be a plain HTTP IPv4 origin without a trailing slash');
  }
  if (!/^uat-[a-zA-Z0-9_.-]+$/.test(config.RELEASE_TAG ?? '') || config.RELEASE_TAG.includes('review-required')) {
    throw new Error('Choose an explicit reviewed UAT release tag');
  }
  for (const key of ['POSTGRES_DB', 'POSTGRES_USER']) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(config[key] ?? '')) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'IOT_INGEST_API_KEY']) {
    if (!/^[a-f0-9]{64,}$/.test(config[key] ?? '')) throw new Error(`${key} must be a generated hex secret`);
  }
  for (const [key, prefix] of [['POSTGRES_IMAGE', 'postgres:18-alpine'], ['CADDY_IMAGE', 'caddy:2-alpine']]) {
    if (!new RegExp(`^${prefix}@sha256:[a-f0-9]{64}$`).test(config[key] ?? '')) throw new Error(`${key} must include an image digest`);
  }
  const port = Number(config.HTTP_PORT);
  if (!/^\d+$/.test(config.HTTP_PORT ?? '') || port < 1 || port > 65535 ||
      [22, 3000, 5432, 7051, 7054, 8080, 8081, 9051, 9054].includes(port) ||
      Number(origin.port || 80) !== port) throw new Error('HTTP_PORT does not match the public origin or conflicts with an internal service');
  if (!['0.0.0.0', '127.0.0.1'].includes(config.HTTP_BIND)) throw new Error('Invalid HTTP_BIND');
  if (!config.UAT_ACCOUNTS_FILE) throw new Error('UAT_ACCOUNTS_FILE is required');
  return config;
}

export function loadConfig(filename) {
  return validateConfig(parse(readFileSync(filename, 'utf8')));
}

export function composeArgs(filename, fabric = false) {
  return ['compose', '--env-file', filename, '-f', 'docker-compose.uat.yml',
    ...(fabric ? ['-f', 'docker-compose.uat-fabric.yml'] : [])];
}
