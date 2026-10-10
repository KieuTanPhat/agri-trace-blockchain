import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CADDY_IMAGE, POSTGRES_IMAGE, caddySiteAddress, validateConfig } from './config.mjs';
import { UAT_ROLES } from './fixtures.mjs';

try {
  const {values} = parseArgs({options: {directory: {type: 'string', default: '.uat'}, origin: {type: 'string', default: 'https://agritrace.dev'}, release: {type: 'string'}}});
  const directory = path.resolve(values.directory);
  const envFile = path.join(directory, '.env.uat');
  const accountsFile = path.join(directory, 'accounts.json');
  if (existsSync(envFile) || existsSync(accountsFile)) throw new Error('Configuration already exists; refusing to overwrite credentials');
  const origin = new URL(values.origin);
  const https = origin.protocol === 'https:';
  const config = validateConfig({
    PUBLIC_ORIGIN: values.origin, CADDY_SITE_ADDRESS: caddySiteAddress(values.origin),
    CORS_ORIGINS: values.origin,
    HTTP_BIND: '0.0.0.0', HTTP_PORT: https ? '80' : origin.port || '80',
    HTTPS_BIND: '0.0.0.0', HTTPS_PORT: '443',
    RELEASE_TAG: values.release, POSTGRES_IMAGE, CADDY_IMAGE,
    POSTGRES_DB: 'agri_trace_uat', POSTGRES_USER: 'agritrace',
    POSTGRES_PASSWORD: randomBytes(32).toString('hex'), JWT_SECRET: randomBytes(32).toString('hex'),
    IOT_INGEST_API_KEY: randomBytes(32).toString('hex'), UAT_ACCOUNTS_FILE: accountsFile.replaceAll('\\', '/'),
    BOOTSTRAP_UID: String(process.getuid?.() ?? 1000), BOOTSTRAP_GID: String(process.getgid?.() ?? 1000),
  });
  const accounts = UAT_ROLES.map(role => ({role, email: `${role.toLowerCase()}@uat.agritrace.test`, password: randomBytes(24).toString('base64url')}));
  mkdirSync(directory, {recursive: true, mode: 0o700});
  writeFileSync(accountsFile, JSON.stringify(accounts, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  writeFileSync(envFile, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', {flag: 'wx', mode: 0o600});
  console.log('Created private UAT configuration and five distinct account credentials. Existing files were not overwritten.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Cannot prepare UAT configuration');
  process.exitCode = 1;
}
