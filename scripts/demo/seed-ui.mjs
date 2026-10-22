// Additive UI fixtures in a migrated, explicitly named local test database only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function validateTarget(env) {
  assert.ok(["development", "test"].includes(env.NODE_ENV), "NODE_ENV must be development or test");
  assert.equal(env.AGRITRACE_UI_SEED, "local-test-only", "Set AGRITRACE_UI_SEED=local-test-only");
  const url = new URL(env.TEST_DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Only loopback PostgreSQL is allowed");
  assert.equal(url.pathname, "/agri_trace_ui_test", "Use the dedicated agri_trace_ui_test database");
  assert.ok(!url.search, "Connection query overrides are not allowed");
  assert.ok(env.UI_SEED_PASSWORD?.length >= 16, "Set UI_SEED_PASSWORD to a local test password of at least 16 characters");
  return url.href;
}

export function fixtureId(name) {
  const hex = createHash("sha256").update(`agritrace-ui-v1:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function main() {
  const connectionString = validateTarget(process.env);
  const { Client } = await import("pg");
  const { hash } = await import("bcrypt");
  const db = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(752141)");
    const target = await db.query("SELECT current_database() AS name");
    assert.equal(target.rows[0].name, "agri_trace_ui_test");
    const migration = await db.query("SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261204000000_platform_admin_console' AND finished_at IS NOT NULL AND rolled_back_at IS NULL");
    assert.equal(migration.rowCount, 1, "Migrate the test database before seeding");
    const passwordHash = await hash(process.env.UI_SEED_PASSWORD, 12);
    const roles = {};
    for (const [code, name] of [["SYSTEM_ADMIN", "Quản trị nền tảng"], ["PROCESSOR", "Nhà chế biến"], ["FARM_STAFF", "Nhà sản xuất"]]) {
      await db.query("INSERT INTO app_role(role_id,code,name) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING", [fixtureId(code), code, name]);
      roles[code] = (await db.query("SELECT role_id FROM app_role WHERE code=$1", [code])).rows[0].role_id;
    }
    async function user(key, name, role, status = "ACTIVE", organization = null, tier = null, supervisor = null) {
      const id = fixtureId(key), email = `${key}@ui.agritrace.test`;
      const existing = await db.query("SELECT user_id FROM app_user WHERE lower(email)=lower($1)", [email]);
      assert.ok(!existing.rowCount || existing.rows[0].user_id === id, `Fixture email collision: ${email}`);
      await db.query(`INSERT INTO app_user(user_id,organization_id,role_id,email,password_hash,full_name,account_status,enterprise_tier,supervisor_id,password_changed_at,member_code)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10) ON CONFLICT(user_id) DO NOTHING`,
      [id, organization, roles[role], email, passwordHash, name, status, tier, supervisor, organization ? `UI${id.slice(0, 8).toUpperCase()}` : null]);
      return id;
    }
    await user("ui-admin", "DEMO · Quản trị giao diện", "SYSTEM_ADMIN");
    await user("ui-admin-locked", "DEMO · Quản trị đã khóa", "SYSTEM_ADMIN", "LOCKED");
    for (const [key, name, type, status] of [
      ["processor", "DEMO · Công ty chế biến nông sản An Nhiên", "PROCESSOR", "ACTIVE"],
      ["processor-inactive", "DEMO · Xưởng đóng gói ngừng hoạt động", "PROCESSOR", "INACTIVE"],
      ["farm", "DEMO · Hợp tác xã rau hữu cơ", "FARM", "ACTIVE"],
    ]) {
      const org = fixtureId(key);
      await db.query("INSERT INTO organization(organization_id,name,type,status) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO NOTHING", [org,name,type,status]);
      await db.query("INSERT INTO organization_capability(organization_id,code) VALUES($1,$2) ON CONFLICT DO NOTHING", [org,type]);
      const role = type === "FARM" ? "FARM_STAFF" : "PROCESSOR";
      const owner = await user(`${key}-owner`, "DEMO · Chủ quản doanh nghiệp", role, "ACTIVE", org, 1);
      await db.query("INSERT INTO scoped_role_grant(grant_id,user_id,organization_id,scope,role) VALUES($1,$2,$3,'ORGANIZATION','ORG_ADMIN') ON CONFLICT DO NOTHING", [fixtureId(`${key}-grant`),owner,org]);
      const manager = await user(`${key}-manager`, "DEMO · Quản lý được ủy quyền", role, "ACTIVE", org, 2, owner);
      const readerRole = fixtureId(`${key}-reader`), managerRole = fixtureId(`${key}-manager-role`);
      for (const [id, label, permissions] of [
        [readerRole,"DEMO · Chỉ xem",["profile.read","members.read","catalog.read","reports.read"]],
        [managerRole,"DEMO · Quản lý nhân sự",["profile.read","members.read","members.manage","roles.manage","catalog.read"]],
        [fixtureId(`${key}-processing-role`),"DEMO · Vận hành",["profile.read",...(type === "PROCESSOR" ? ["processing.read","processing.write"] : ["production.read","production.write"])]],
      ]) await db.query("INSERT INTO enterprise_role(id,organization_id,name,permissions) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [id,org,label,permissions]);
      const members = [[manager,managerRole]];
      for (const [suffix, accountStatus, label] of [["active","ACTIVE","Nhân viên hoạt động"],["locked","LOCKED","Nhân viên đã khóa"],["inactive","INACTIVE","Thành viên đã ngừng"]]) {
        const id = await user(`${key}-${suffix}`, `DEMO · ${label}`, role, accountStatus, org, 3, manager);
        if (accountStatus !== "INACTIVE") members.push([id,readerRole]);
      }
      for (const [id, roleId] of members) await db.query("INSERT INTO enterprise_member_role(user_id,organization_id,role_id,chain_ids,site_ids) VALUES($1,$2,$3,'{}','{}') ON CONFLICT DO NOTHING", [id,org,roleId]);
    }
    await db.query("COMMIT");
    console.log("UI fixtures ready. Existing records/passwords were left unchanged.");
    console.log("Accounts: ui-admin@ui.agritrace.test, processor-owner@ui.agritrace.test, farm-owner@ui.agritrace.test. Password: the UI_SEED_PASSWORD used on the first run.");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
