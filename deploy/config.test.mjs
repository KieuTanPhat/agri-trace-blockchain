import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caddySiteAddress, CADDY_IMAGE, POSTGRES_IMAGE, validateConfig } from './config.mjs';

const aliases = 'https://trace.example.com,https://www.trace.example.com';
const config = {
  PUBLIC_ORIGIN: 'https://agritrace.dev', PUBLIC_ALIAS_ORIGINS: aliases,
  CADDY_SITE_ADDRESS: 'agritrace.dev, www.agritrace.dev, http://13.140.170.166, trace.example.com, www.trace.example.com',
  CORS_ORIGINS: `https://agritrace.dev,${aliases}`, RELEASE_TAG: 'uat-alias-test',
  POSTGRES_DB: 'agri_trace_test', POSTGRES_USER: 'agritrace', POSTGRES_PASSWORD: 'a'.repeat(64),
  JWT_SECRET: 'b'.repeat(64), IOT_INGEST_API_KEY: 'c'.repeat(64), POSTGRES_IMAGE, CADDY_IMAGE,
  HTTP_PORT: '80', HTTPS_PORT: '443', HTTP_BIND: '0.0.0.0', HTTPS_BIND: '0.0.0.0', UAT_ACCOUNTS_FILE: './test-accounts.json',
};

test('HTTPS alias configuration keeps the primary domain, www, and legacy IP', () => {
  assert.equal(caddySiteAddress(config.PUBLIC_ORIGIN, aliases), config.CADDY_SITE_ADDRESS);
  assert.equal(validateConfig(config), config);
  assert.equal(caddySiteAddress(config.PUBLIC_ORIGIN), 'agritrace.dev, www.agritrace.dev, http://13.140.170.166');
});

test('CORS must include aliases and aliases cannot inject paths, ports, or arbitrary Caddy syntax', () => {
  assert.throws(() => validateConfig({...config, CORS_ORIGINS: config.PUBLIC_ORIGIN}), /every HTTPS alias/);
  for (const alias of ['http://trace.example.com', 'https://127.0.0.1', 'https://trace.example.com/',
    'https://trace.example.com:8443', 'https://user@trace.example.com', 'https://trace.example.com?query=1', 'https://*.trace.example.com']) {
    assert.throws(() => caddySiteAddress(config.PUBLIC_ORIGIN, alias));
  }
  assert.throws(() => caddySiteAddress('http://13.140.170.166', aliases), /primary HTTPS origin/);
});
