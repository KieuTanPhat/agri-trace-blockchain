import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('..', import.meta.url));
const url = process.env.TEST_DATABASE_URL;
if (!url || process.env.HYBRID_DRAFT_TESTS !== '1') {
  console.error('Schema alignment requires TEST_DATABASE_URL and explicit isolated-database opt-in');
  process.exit(1);
}

// Diff is diagnostic only. Never pipe its output into db execute or psql.
const diff = spawnSync(process.execPath, [
  require.resolve('prisma/build/index.js'), 'migrate', 'diff',
  '--from-config-datasource', '--to-schema', 'prisma/schema.prisma',
  '--script', '--exit-code',
], { cwd, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
if (diff.status !== 0) {
  console.error('Schema drift detected; generated SQL has NOT been executed');
  // SQL contains schema names, not business rows or connection credentials.
  if (diff.stdout) process.stdout.write(diff.stdout);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const { rows } = await client.query(`
    SELECT c.relname AS name, i.indisunique AS unique, i.indisvalid AS valid,
           pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
  `, [[
    'uq_sensor_digest_window', 'ux_sensor_digest_final_cycle',
    'ux_tracking_binding_active_device', 'uq_stage_cycle_active',
    'uq_stage_lot_active', 'uq_stage_shipment_active',
  ]]);
  const indexes = new Map(rows.map((row) => [row.name, row]));
  for (const name of [
    'uq_sensor_digest_window', 'ux_sensor_digest_final_cycle',
    'ux_tracking_binding_active_device', 'uq_stage_cycle_active',
    'uq_stage_lot_active', 'uq_stage_shipment_active',
  ]) {
    const index = indexes.get(name);
    if (!index?.unique || !index.valid) throw new Error(`Missing valid unique guard: ${name}`);
    if (name !== 'uq_sensor_digest_window' && !index.predicate)
      throw new Error(`Missing partial-index predicate: ${name}`);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ schemaAligned: true, uniqueGuards: indexes.size, sqlExecuted: false }));
} catch {
  console.error('Schema guard verification failed; inspect restricted diagnostics');
  process.exitCode = 1;
} finally {
  await client.end();
}
