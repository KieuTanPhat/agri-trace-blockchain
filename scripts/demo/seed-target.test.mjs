import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedTarget } from './seed-target.mjs';

const local = { AGRITRACE_LOCAL_SEED_TARGET: 'agri-trace-demo-local/agri_trace', FABRIC_ENABLED: 'false',
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/agri_trace', PUBLIC_TRACE_BASE_URL: 'http://localhost:3000/trace' };
const production = { AGRITRACE_PRODUCTION_DATASET: 'true', APP_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@postgres:5432/agri_trace_prod?schema=public',
  PUBLIC_TRACE_BASE_URL: 'https://agritrace.dev/trace', AGRITRACE_INSTALLATION_GENERATION: 'a'.repeat(32) };

test('local seed keeps its exact simulator target', () => {
  assert.equal(seedTarget(local).mode, 'local');
  for (const change of [{ FABRIC_ENABLED: 'true' }, { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/agri_trace' },
    { AGRITRACE_LOCAL_SEED_TARGET: undefined }, { PUBLIC_TRACE_BASE_URL: 'https://agritrace.dev/trace' }])
    assert.throws(() => seedTarget({ ...local, ...change }));
});

test('production seed refuses mixed, foreign or unpinned targets before reading its run directory', () => {
  for (const change of [{ AGRITRACE_LOCAL_SEED_TARGET: 'agri-trace-demo-local/agri_trace' }, { APP_ENV: 'development' },
    { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/agri_trace' },
    { DATABASE_URL: 'postgresql://u:p@postgres:5432/agri_trace' },
    { PUBLIC_TRACE_BASE_URL: 'http://localhost:3000/trace' }, { AGRITRACE_INSTALLATION_GENERATION: 'short' }])
    assert.throws(() => seedTarget({ ...production, ...change }), error => error.code === 'ERR_ASSERTION');
});
