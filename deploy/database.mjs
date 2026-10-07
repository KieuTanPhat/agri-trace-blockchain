import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import pg from 'pg';
import { loadConfig, composeArgs } from './config.mjs';

const tables = ['app_user', 'organization', 'farm', 'product', 'production_cycle', 'harvest_event', 'lot', 'shipment', 'trace_event', 'blockchain_outbox', 'blockchain_proof'];
const countSql = `SELECT json_build_object(${tables.map(table => `'${table}', (SELECT count(*) FROM public.${table})`).join(',')})::text`;
const eventSql = "SELECT coalesce(md5(string_agg(event_id::text || ':' || data_hash, ',' ORDER BY event_id)), md5('')) AS hash FROM public.trace_event";

async function checksum(filename) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}

async function run(command, args, options, input, output) {
  const child = spawn(command, args, {...options, stdio: ['pipe', 'pipe', 'pipe']});
  child.stderr.resume(); // Do not forward potentially sensitive diagnostics.
  let startupError;
  const completed = new Promise((resolve, reject) => {
    child.on('error', error => {startupError = error; reject(new Error('Database utility could not start'));});
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Database utility failed; credentials and SQL diagnostics withheld')));
  });
  // Attach a handler immediately while streams are being established.
  completed.catch(() => {});
  const streams = [];
  if (input) streams.push(pipeline(createReadStream(input), child.stdin));
  else child.stdin.end();
  if (output) streams.push(pipeline(child.stdout, createWriteStream(output, {flags: 'wx', mode: 0o600})));
  else child.stdout.resume();
  await Promise.all([completed, ...streams]);
  if (startupError) throw new Error('Database utility could not start');
}

function sql(config, envFile, query) {
  const result = spawnSync('docker', [...composeArgs(envFile), 'exec', '-T', 'postgres', 'psql', '-U', config.POSTGRES_USER, '-d', config.POSTGRES_DB, '-v', 'ON_ERROR_STOP=1', '-Atc', query], {encoding: 'utf8', maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, 'Database inspection failed; diagnostics withheld');
  return result.stdout.trim();
}

function requireWritersStopped(envFile) {
  const result = spawnSync('docker', [...composeArgs(envFile), 'ps', '--status', 'running', '--services'], {encoding: 'utf8'});
  assert.equal(result.status, 0, 'Cannot inspect running services');
  const running = new Set(result.stdout.trim().split(/\s+/));
  assert.ok(['api', 'worker', 'bootstrap', 'migrate'].every(name => !running.has(name)), 'Stop all application writers before database backup or restore');
}

try {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    env: {type: 'string', default: '.uat/.env.uat'}, 'source-env': {type: 'string', default: 'apps/api/.env'},
    file: {type: 'string', default: '.uat/source.dump'},
  }});
  const filename = path.resolve(values.file);
  const manifestFile = filename + '.manifest.json';
  if (positionals[0] === 'backup-source') {
    assert.ok(!existsSync(filename) && !existsSync(manifestFile), 'Backup files already exist; refusing overwrite');
    const source = parse(readFileSync(values['source-env'], 'utf8'));
    assert.ok(source.DATABASE_URL, 'Source DATABASE_URL is unavailable');
    const url = new URL(source.DATABASE_URL);
    const client = new pg.Client({connectionString: source.DATABASE_URL});
    try {
      await client.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
      const serverVersion = (await client.query('SHOW server_version')).rows[0].server_version;
      assert.equal(Number.parseInt(serverVersion, 10), 18, 'Source must match the PostgreSQL 18 UAT target');
      const counts = JSON.parse((await client.query(countSql)).rows[0].json_build_object);
      const events = (await client.query(eventSql)).rows[0].hash;
      mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
      const environment = {...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1))};
      if (url.searchParams.has('sslmode')) environment.PGSSLMODE = url.searchParams.get('sslmode');
      await run(process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`, `--file=${filename}`], {env: environment});
      chmodSync(filename, 0o600);
      writeFileSync(manifestFile, JSON.stringify({serverVersion, counts, traceHashDigest: events, sha256: await checksum(filename), createdAt: new Date().toISOString()}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
      await client.query('COMMIT');
      console.log(JSON.stringify({result: 'passed', operation: 'consistent source backup', serverVersion, counts}));
    } finally {await client.end();}
  } else if (positionals[0] === 'restore-empty') {
    const config = loadConfig(values.env);
    requireWritersStopped(values.env);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    assert.equal(Number.parseInt(manifest.serverVersion, 10), 18, 'Backup server version mismatch');
    assert.ok(manifest.counts && manifest.traceHashDigest, 'Backup verification metadata is missing');
    assert.equal(await checksum(filename), manifest.sha256, 'Dump checksum mismatch');
    assert.equal(Number.parseInt(sql(config, values.env, 'SHOW server_version'), 10), 18, 'Target server version mismatch');
    const tableCount = Number(sql(config, values.env, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')"));
    assert.equal(tableCount, 0, 'Target is not empty; refusing restore into existing data');
    await run('docker', [...composeArgs(values.env), 'exec', '-T', 'postgres', 'pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '-U', config.POSTGRES_USER, '-d', config.POSTGRES_DB], {}, filename);
    const counts = JSON.parse(sql(config, values.env, countSql));
    assert.deepEqual(counts, manifest.counts, 'Restored table counts mismatch');
    assert.equal(sql(config, values.env, eventSql), manifest.traceHashDigest, 'Restored trace hashes mismatch');
    console.log(JSON.stringify({result: 'passed', operation: 'restore and verify', counts, confirmedProofsRequireLedgerReconciliation: counts.blockchain_proof > 0}));
  } else if (positionals[0] === 'backup-uat') {
    const config = loadConfig(values.env);
    requireWritersStopped(values.env);
    assert.ok(!existsSync(filename) && !existsSync(manifestFile), 'Backup files already exist; refusing overwrite');
    const serverVersion = sql(config, values.env, 'SHOW server_version');
    assert.equal(Number.parseInt(serverVersion, 10), 18, 'UAT backup requires PostgreSQL 18');
    const counts = JSON.parse(sql(config, values.env, countSql));
    const traceHashDigest = sql(config, values.env, eventSql);
    mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
    await run('docker', [...composeArgs(values.env), 'exec', '-T', 'postgres', 'pg_dump', '--format=custom', '--no-owner', '--no-acl', '-U', config.POSTGRES_USER, '-d', config.POSTGRES_DB], {}, undefined, filename);
    assert.deepEqual(JSON.parse(sql(config, values.env, countSql)), counts, 'Data changed during backup');
    assert.equal(sql(config, values.env, eventSql), traceHashDigest, 'Trace data changed during backup');
    writeFileSync(manifestFile, JSON.stringify({serverVersion, counts, traceHashDigest, sha256: await checksum(filename), createdAt: new Date().toISOString(), operation: 'UAT backup'}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log('UAT backup completed; archive contents were not printed.');
  } else throw new Error('Use backup-source, restore-empty or backup-uat');
} catch (error) {
  // Database/driver errors can contain connection strings or rows.
  console.error('Database operation failed; no existing archive or database was intentionally overwritten. Check paths, target emptiness and version.');
  process.exitCode = 1;
}
