// The two places the 28-product dataset may be written. Local uses the
// simulated ledger; production runs in a one-off API-image container on the
// production Compose network and binds chains through the root operator.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const LEDGER_REQUIRED_EXIT = 75;
export const PRODUCTION_ORIGIN = 'https://agritrace.dev';

export function seedTarget(environment = process.env) {
  const url = new URL(environment.DATABASE_URL);
  if (environment.AGRITRACE_PRODUCTION_DATASET === 'true') {
    assert.equal(environment.AGRITRACE_LOCAL_SEED_TARGET, undefined, 'Local and production targets cannot be mixed');
    assert.equal(environment.APP_ENV, 'production');
    assert.equal(url.hostname, 'postgres');
    assert.equal(url.port || '5432', '5432');
    assert.equal(url.pathname, '/agri_trace_prod');
    assert.equal(environment.PUBLIC_TRACE_BASE_URL?.replace(/\/$/, ''), `${PRODUCTION_ORIGIN}/trace`);
    const generation = environment.AGRITRACE_INSTALLATION_GENERATION;
    assert.match(generation ?? '', /^[a-f0-9]{32}$/);
    // The root runner writes this file for the generation it just installed.
    const pinned = JSON.parse(readFileSync('/dataset-run/target.json', 'utf8'));
    assert.equal(pinned.protocol, 'agritrace-production-dataset/1');
    assert.equal(pinned.generation, generation, 'Seed run directory belongs to another installation; reconcile before continuing');
    // The controller's technical smoke accounts; the dataset adds every other identity.
    const baselineUserIds = pinned.baselineUserIds;
    assert.ok(Array.isArray(baselineUserIds) && baselineUserIds.length === 5 && new Set(baselineUserIds).size === 5);
    for (const id of baselineUserIds) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    return { mode: 'production', run: '/dataset-run', assets: '/dataset-assets', apiBase: 'http://api:8080/api',
      databaseUrl: url.href, generation, baselineUserIds };
  }
  assert.equal(environment.AGRITRACE_LOCAL_SEED_TARGET, 'agri-trace-demo-local/agri_trace');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/agri_trace');
  assert.equal(environment.FABRIC_ENABLED, 'false');
  assert.match(environment.PUBLIC_TRACE_BASE_URL ?? '', /^http:\/\/localhost:3000\/trace\/?$/);
  return { mode: 'local', run: `${root}.codex/fruit-dataset/run`, assets: `${root}.codex/fruit-assets`,
    apiBase: 'http://127.0.0.1:8080/api', databaseUrl: url.href, baselineUserIds: [] };
}
