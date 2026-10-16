import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
const migration = '20261017000000_hybrid_fresh_install';
const root = path.resolve('prisma/migrations');
const created: string[] = [];

function urlFor(database: string) {
  const url = new URL(connectionString!);
  if (!/(?:_test|_ci|checks)$/.test(url.pathname))
    throw new Error('Fresh-install rehearsal requires an isolated test database');
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

async function prepare(legacy: boolean) {
  const name = `agritrace_fresh_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    created.push(name);
  } finally {
    await admin.end();
  }
  const db = new Client({ connectionString: urlFor(name) });
  await db.connect();
  const names = readdirSync(root).filter((name) => /^\d{14}_/.test(name)).sort();
  expect(names).toContain(migration);
  for (const name of names.slice(0, names.indexOf(migration))) {
    if (legacy && name === '20261014000000_hybrid_chain_scope')
      await db.query(readFileSync('test/fixtures/business-data.sql', 'utf8'));
    await db.query(readFileSync(path.join(root, name, 'migration.sql'), 'utf8'));
  }
  return db;
}

(connectionString ? describe : describe.skip)('Append-only fresh installation', () => {
  afterAll(async () => {
    const admin = new Client({ connectionString: urlFor('postgres') });
    await admin.connect();
    try {
      for (const name of created)
        await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it('builds the new schema without historical exemptions from an empty database', async () => {
    const db = await prepare(false);
    try {
      await db.query(readFileSync(path.join(root, migration, 'migration.sql'), 'utf8'));
      expect((await db.query("SELECT to_regclass('ledger_route_exemption') AS obsolete")).rows[0].obsolete).toBeNull();
      const guards = await db.query("SELECT pg_get_functiondef(oid) AS body FROM pg_proc WHERE proname IN ('fn_hybrid_event_route_insert', 'fn_hybrid_proof_matches_route', 'fn_hybrid_new_event_requires_route')");
      expect(guards.rows).toHaveLength(3);
      expect(guards.rows.every((row) => !row.body.includes('ledger_route_exemption'))).toBe(true);
      expect((await db.query('SELECT count(*)::int AS events FROM trace_event')).rows[0].events).toBe(0);
    } finally {
      await db.end();
    }
  }, 60_000);

  it('rejects historical business data and leaves events, proofs and exemptions intact', async () => {
    const db = await prepare(true);
    try {
      const inventory = () => db.query('SELECT event_id, data_hash, previous_event_hash FROM trace_event ORDER BY event_id');
      const before = (await inventory()).rows;
      expect(before.length).toBeGreaterThan(0);
      const proofs = (await db.query('SELECT event_id, tx_id, data_hash FROM blockchain_proof ORDER BY event_id')).rows;
      await expect(db.query(readFileSync(path.join(root, migration, 'migration.sql'), 'utf8'))).rejects.toThrow(/empty business database/);
      await db.query('ROLLBACK');
      expect((await inventory()).rows).toEqual(before);
      expect((await db.query('SELECT event_id, tx_id, data_hash FROM blockchain_proof ORDER BY event_id')).rows).toEqual(proofs);
      expect((await db.query('SELECT count(*)::int AS exemptions FROM ledger_route_exemption')).rows[0].exemptions).toBe(before.length);
    } finally {
      await db.end();
    }
  }, 60_000);
});
