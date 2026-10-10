import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caddySiteAddress, CADDY_IMAGE, POSTGRES_IMAGE, validateConfig } from './config.mjs';

const aliases = 'https://agritrace.dev,https://www.agritrace.dev';
const config = {
  PUBLIC_ORIGIN: 'https://nongtrace.site', PUBLIC_ALIAS_ORIGINS: aliases,
  CADDY_SITE_ADDRESS: 'nongtrace.site, www.nongtrace.site, http://13.140.170.166, agritrace.dev, www.agritrace.dev',
  CORS_ORIGINS: `https://nongtrace.site,${aliases}`, RELEASE_TAG: 'uat-alias-test',
  POSTGRES_DB: 'agri_trace_test', POSTGRES_USER: 'agritrace', POSTGRES_PASSWORD: 'a'.repeat(64),
  JWT_SECRET: 'b'.repeat(64), IOT_INGEST_API_KEY: 'c'.repeat(64), POSTGRES_IMAGE, CADDY_IMAGE,
  HTTP_PORT: '80', HTTPS_PORT: '443', HTTP_BIND: '0.0.0.0', HTTPS_BIND: '0.0.0.0', UAT_ACCOUNTS_FILE: './test-accounts.json',
};

test('HTTPS alias configuration keeps the primary domain, www, and legacy IP', () => {
  assert.equal(caddySiteAddress(config.PUBLIC_ORIGIN, aliases), config.CADDY_SITE_ADDRESS);
  assert.equal(validateConfig(config), config);
  assert.equal(caddySiteAddress(config.PUBLIC_ORIGIN), 'nongtrace.site, www.nongtrace.site, http://13.140.170.166');
});

test('CORS must include aliases and aliases cannot inject paths, ports, or arbitrary Caddy syntax', () => {
  assert.throws(() => validateConfig({...config, CORS_ORIGINS: config.PUBLIC_ORIGIN}), /every HTTPS alias/);
  for (const alias of ['http://agritrace.dev', 'https://127.0.0.1', 'https://agritrace.dev/',
    'https://agritrace.dev:8443', 'https://user@agritrace.dev', 'https://agritrace.dev?query=1', 'https://*.agritrace.dev']) {
    assert.throws(() => caddySiteAddress(config.PUBLIC_ORIGIN, alias));
  }
  assert.throws(() => caddySiteAddress('http://13.140.170.166', aliases), /primary HTTPS origin/);
});
