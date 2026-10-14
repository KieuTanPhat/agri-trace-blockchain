import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Pinned like the production Compose models. These images exist only in disposable CI projects.
export const POSTGRES_IMAGE = 'postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
export const CADDY_IMAGE = 'caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f';

// Counted before backup and after restore; a restored database must reproduce them exactly.
export const COUNT_TABLES = ['app_user', 'organization', 'farm', 'product', 'production_cycle', 'harvest_event', 'lot', 'shipment', 'trace_event', 'blockchain_outbox', 'blockchain_proof'];
export const COUNT_SQL = `SELECT json_build_object(${COUNT_TABLES.map(table => `'${table}', (SELECT count(*) FROM public.${table})`).join(',')})::text`;
export const EVENT_SQL = "SELECT coalesce(md5(string_agg(event_id::text || ':' || data_hash, ',' ORDER BY event_id)), md5('')) AS hash FROM public.trace_event";

/** Names every resource of one rehearsal. Only a GitHub runner may create them, so a laptop or VPS cannot. */
export function rehearsalIdentity(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Only disposable GitHub runners may run the production rehearsal');
  assert.match(env.GITHUB_RUN_ID ?? '', /^[0-9]+$/);
  assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[0-9]+$/);
  const project = `agritrace-prod-ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  return { project, ingress: `${project}-ingress`, volume: `${project}-postgres`, imageTag: `agritrace-ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}` };
}

/** Docker resources of a Compose project, by Compose's own ownership label. `exec` returns stdout. */
export function ownedResources(exec, project) {
  const found = [];
  for (const [kind, args] of [
    ['container', ['ps', '-aq']],
    ['volume', ['volume', 'ls', '-q']],
    ['network', ['network', 'ls', '-q']],
  ]) {
    const output = exec('docker', [...args, '--filter', `label=com.docker.compose.project=${project}`]).trim();
    if (output) found.push(...output.split(/\s+/).map(id => `${kind}:${id}`));
  }
  return found;
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return index;
  }
  throw new Error('Unbalanced braces in Caddyfile');
}

/**
 * Builds the CI proxy from the production edge file itself, so a routing change to the real
 * `(application)` snippet (docs hidden, /api and web upstreams) is what the rehearsal exercises.
 */
export function proxyCaddyfile(production) {
  const normalized = production.replace(/\r\n/g, '\n');
  const global = normalized.match(/^\{\n[\s\S]*?\n\}\n/);
  assert.ok(global, 'Production Caddyfile no longer starts with a global options block');
  const header = '(application) {';
  const at = normalized.indexOf(header);
  assert.ok(at >= 0, 'Production Caddyfile no longer defines the (application) snippet');
  const snippet = normalized.slice(at, matchingBrace(normalized, at + header.length - 1) + 1);
  assert.match(snippet, /respond "Not found" 404/, 'The API documentation must stay hidden at the edge');
  assert.match(snippet, /reverse_proxy \{args\[0\]\}:8080/);
  assert.match(snippet, /reverse_proxy \{args\[1\]\}:3000/);
  return `${global[0]}${snippet}\n\n:80 {\n    import application prod-api prod-web\n}\n`;
}

export function migrationChecksums(root) {
  const base = path.join(root, 'apps/api/prisma/migrations');
  return Object.fromEntries(readdirSync(base)
    .filter(name => existsSync(path.join(base, name, 'migration.sql')))
    .sort()
    .map(name => [name, createHash('sha256').update(readFileSync(path.join(base, name, 'migration.sql'))).digest('hex')]));
}

/** `applied` are `_prisma_migrations` rows. Returns human-readable problems, empty when identical. */
export function migrationErrors(applied, expected) {
  const errors = [];
  const rows = new Map(applied.map(row => [row.migration_name, row]));
  for (const [name, checksum] of Object.entries(expected)) {
    const row = rows.get(name);
    if (!row) errors.push(`${name}: not applied`);
    else if (row.checksum !== checksum) errors.push(`${name}: applied checksum differs from the repository`);
    else if (!row.finished_at || row.rolled_back_at) errors.push(`${name}: not finished`);
  }
  for (const name of rows.keys()) if (!(name in expected)) errors.push(`${name}: applied but absent from the repository`);
  return errors;
}

const bytes = value => Number(String(value));

/** Production capacity rule: every service has CPU and memory quotas; only the proxy is published, on loopback. */
export function composeModelErrors(model, { project, services }) {
  const errors = [];
  if (model.name !== project) errors.push(`Compose project is ${model.name}, expected ${project}`);
  const names = Object.keys(model.services ?? {}).sort();
  if (JSON.stringify(names) !== JSON.stringify([...services].sort())) errors.push(`Unexpected services: ${names.join(', ')}`);
  for (const [name, service] of Object.entries(model.services ?? {})) {
    if (!(bytes(service.mem_limit) > 0)) errors.push(`${name}: memory quota missing`);
    if (!(Number(service.cpus) > 0)) errors.push(`${name}: CPU quota missing`);
    if (service.privileged || service.cap_add?.length || service.devices?.length || service.network_mode || service.pid) errors.push(`${name}: unexpected privilege`);
    for (const port of service.ports ?? []) {
      if (name !== 'proxy' || port.host_ip !== '127.0.0.1') errors.push(`${name}: unexpected published port`);
    }
  }
  return errors;
}
