import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
const MIGRATION = '20261014000000_hybrid_chain_scope';
const migrationsDir = path.resolve('prisma/migrations');
const database = `agritrace_rehearsal_${process.pid}`;

function urlFor(name: string) {
  const url = new URL(connectionString!.replace(/\?.*$/, ''));
  url.pathname = `/${name}`;
  return url.toString();
}

/** Applies production migrations to a disposable database, loads a legacy
 * dataset, then applies release A and checks the deterministic backfill. */
(connectionString ? describe : describe.skip)(
  'Release A migration rehearsal on legacy data',
  () => {
    let db: Client;
    let hashesBefore: unknown[];

    beforeAll(async () => {
      const admin = new Client({ connectionString: urlFor('postgres') });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${database}`);
      await admin.end();
      db = new Client({ connectionString: urlFor(database) });
      await db.connect();
      const migrations = readdirSync(migrationsDir)
        .filter((name) => /^\d{14}_/.test(name))
        .sort();
      const cut = migrations.indexOf(MIGRATION);
      for (const name of migrations.slice(0, cut))
        await db.query(
          readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'),
        );
      await db.query(readFileSync('test/fixtures/legacy-core.sql', 'utf8'));
      hashesBefore = (
        await db.query(
          'SELECT event_id, data_hash, previous_event_hash FROM trace_event ORDER BY event_id',
        )
      ).rows;
      await db.query(
        readFileSync(
          path.join(migrationsDir, MIGRATION, 'migration.sql'),
          'utf8',
        ),
      );
    }, 60_000);

    afterAll(async () => {
      await db?.end();
      const admin = new Client({ connectionString: urlFor('postgres') });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    });

    const rows = async (sql: string) => (await db.query(sql)).rows;

    it('creates one legacy chain per producer with cycles, owned by it', async () => {
      expect(
        await rows(
          `SELECT o.name, p.state FROM supply_chain c
           JOIN organization o ON o.organization_id = c.owner_organization_id
           JOIN chain_business_profile p USING (chain_id)`,
        ),
      ).toEqual([{ name: 'Farm A', state: 'ACTIVE' }]);
      expect(
        await rows(
          `SELECT count(*)::int AS unscoped FROM production_cycle WHERE chain_id IS NULL`,
        ),
      ).toEqual([{ unscoped: 0 }]);
    });

    it('adds only organizations that took part in the chain history', async () => {
      expect(
        (
          await rows(
            `SELECT o.name FROM chain_membership m JOIN organization o USING (organization_id)
             WHERE m.status = 'ACTIVE' ORDER BY o.name`,
          )
        ).map((row) => row.name),
      ).toEqual(['Auditor X', 'Farm A', 'Retail R', 'Transport T']);
    });

    it('maps legacy roles to scoped grants without granting platform users', async () => {
      const grants = await rows(
        `SELECT u.email, g.role::text AS role, g.chain_id IS NOT NULL AS chained
         FROM scoped_role_grant g JOIN app_user u USING (user_id)
         ORDER BY u.email, g.role::text`,
      );
      expect(grants).toContainEqual({
        email: 'a1@legacy.test',
        role: 'ORG_ADMIN',
        chained: false,
      });
      expect(grants).toContainEqual({
        email: 'a1@legacy.test',
        role: 'CREATE_CHAIN',
        chained: false,
      });
      expect(grants).toContainEqual({
        email: 'a1@legacy.test',
        role: 'CHAIN_MANAGER',
        chained: true,
      });
      expect(grants).toContainEqual({
        email: 'a2@legacy.test',
        role: 'FARM_STAFF',
        chained: true,
      });
      expect(grants).toContainEqual({
        email: 't1@legacy.test',
        role: 'TRANSPORTER',
        chained: true,
      });
      expect(grants).toContainEqual({
        email: 'r1@legacy.test',
        role: 'RETAILER',
        chained: true,
      });
      expect(grants).toContainEqual({
        email: 'x1@legacy.test',
        role: 'COMPLIANCE_REVIEWER',
        chained: true,
      });
      // a2 is not the earliest user: no organization administration.
      expect(grants).not.toContainEqual({
        email: 'a2@legacy.test',
        role: 'ORG_ADMIN',
        chained: false,
      });
      // Farm B has no history: its staff gets no chain grant.
      expect(
        grants.filter((g) => g.email === 'b1@legacy.test' && g.chained),
      ).toEqual([]);
      expect(grants.filter((g) => g.email === 'admin@legacy.test')).toEqual([]);
    });

    it('accepts the existing stage assignments and keeps cycle timestamps', async () => {
      expect(
        await rows(
          `SELECT stage::text, status::text, count(*)::int AS n FROM stage_assignment
           GROUP BY 1, 2 ORDER BY 1`,
        ),
      ).toEqual([
        { stage: 'PRODUCTION', status: 'ACCEPTED', n: 1 },
        { stage: 'RETAIL', status: 'ACCEPTED', n: 1 },
        { stage: 'TRANSPORT', status: 'ACCEPTED', n: 1 },
      ]);
      expect(
        (
          await rows(`SELECT updated_at FROM production_cycle`)
        )[0].updated_at.toISOString(),
      ).toBe('2026-02-01T00:00:00.000Z');
    });

    it('adds scope sidecars without rewriting any trace hash or proof', async () => {
      expect(
        (
          await db.query(
            'SELECT event_id, data_hash, previous_event_hash FROM trace_event ORDER BY event_id',
          )
        ).rows,
      ).toEqual(hashesBefore);
      expect(
        await rows(`SELECT count(*)::int AS n FROM event_chain_context`),
      ).toEqual([{ n: 3 }]);
      expect(
        await rows(`SELECT count(*)::int AS n FROM ledger_route_exemption`),
      ).toEqual([{ n: 3 }]);
      expect(
        await rows(
          `SELECT tx_id, transaction_status::text FROM blockchain_proof`,
        ),
      ).toEqual([{ tx_id: 'tx-legacy-1', transaction_status: 'CONFIRMED' }]);
    });

    it('seals the legacy exemption set and the cycle scope', async () => {
      await expect(
        db.query(
          `INSERT INTO ledger_route_exemption (event_id)
           SELECT event_id FROM trace_event LIMIT 1`,
        ),
      ).rejects.toThrow();
      await expect(
        db.query(`UPDATE production_cycle SET chain_id = gen_random_uuid()`),
      ).rejects.toThrow();
    });
  },
);
