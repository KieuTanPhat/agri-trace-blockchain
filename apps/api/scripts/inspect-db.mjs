import 'dotenv/config';
import pg from 'pg';

// Read-only local diagnostics. Never print connection strings or row contents.
async function main() {
  let url;
  try { url = new URL(process.env.DATABASE_URL); } catch { throw Error('DATABASE_URL không hợp lệ.'); }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/(?:^|_)test(?:_|$)/i.test(database) ||
      /(?:prod|production)/i.test(database) ||
      process.env.AGRI_DB_INSPECT_CONFIRM !== database)
    throw Error('Chỉ đọc DB test local đã xác nhận bằng AGRI_DB_INSPECT_CONFIRM.');
  const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const identity = (await client.query(`
      SELECT current_database() AS database, current_setting('server_version') AS version,
             pg_size_pretty(pg_database_size(current_database())) AS database_size
    `)).rows[0];
    if (identity.database !== database) throw Error('Target database không khớp.');
    const tables = (await client.query(`
      SELECT relname AS table_name, n_live_tup AS estimated_rows,
             n_dead_tup AS estimated_dead_rows,
             pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
             pg_size_pretty(pg_indexes_size(relid)) AS index_size,
             seq_scan, idx_scan, last_autovacuum, last_autoanalyze
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC, relname LIMIT 20
    `)).rows;
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ ...identity, tables,
      note: 'Số dòng từ thống kê là ước lượng; không suy ra index thừa chỉ từ idx_scan=0. Công cụ chỉ đọc, không VACUUM/xóa dữ liệu.' }, null, 2));
  } finally { await client.end(); }
}

main().catch(() => {
  console.error('Không đọc được thống kê. Kiểm tra PostgreSQL, DATABASE_URL local và AGRI_DB_INSPECT_CONFIRM; không in thông tin kết nối.');
  process.exitCode = 1;
});
