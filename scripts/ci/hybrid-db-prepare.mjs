import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
);
const api = join(root, "apps/api");
const require = createRequire(join(api, "prisma.config.ts"));
const migrationRoot = "apps/api/prisma/migrations";
const scopeMigration = "20261013010000_hybrid_business_scope";
const routeMigration = "20261013011000_immutable_ledger_routes";
const sourcePaths = [
  "apps/api",
  "apps/web",
  "blockchain/gateway",
  "docs/sql",
  "package.json",
  "package-lock.json",
  "scripts/ci",
];
const commandDeadlineMs = 300000;
let control, sourceSha, stagedCatalog, stage, mode;

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: root,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function sourceUnchanged() {
  ensure(git(["rev-parse", "HEAD"]).trim() === sourceSha, "Source SHA changed");
  git([
    "ls-files",
    "--error-unmatch",
    "scripts/ci/hybrid-db-prepare.mjs",
    "scripts/ci/hybrid-orm-check.mjs",
    `${migrationRoot}/${scopeMigration}/migration.sql`,
    `${migrationRoot}/${routeMigration}/migration.sql`,
  ]);
  git([
    "diff",
    "--exit-code",
    "--no-ext-diff",
    sourceSha,
    "--",
    ...sourcePaths,
  ]);
  ensure(
    git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ...sourcePaths,
    ]).trim() === "",
    "Untracked source would invalidate exact-SHA preparation",
  );
}

function inside(path, parent) {
  const child = relative(parent, path);
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

function privateControl(path) {
  ensure(path && isAbsolute(path), "Absolute HYBRID_CI_CONTROL is required");
  const evidence = realpathSync(join(root, ".codex/evidence"));
  ensure(
    inside(evidence, root),
    "Evidence directory must remain inside this repository",
  );
  const requested = resolve(path);
  const parent = realpathSync(dirname(requested));
  ensure(
    parent === evidence || inside(parent, evidence),
    "Control must remain inside repository evidence",
  );
  ensure(
    inside(requested, evidence),
    "Control must be a descendant of repository evidence",
  );
  ensure(
    parent === resolve(dirname(requested)),
    "Control ancestors must not redirect through symlinks",
  );
  mkdirSync(requested, { recursive: false, mode: 0o700 });
  return realpathSync(requested);
}

function isolatedUrl() {
  ensure(process.env.NODE_ENV === "test", "NODE_ENV=test is required");
  ensure(
    process.env.HYBRID_DRAFT_TESTS === "1",
    "Isolated fixture opt-in is required",
  );
  ensure(process.env.HYBRID_CI_TESTS === "1", "Isolated CI opt-in is required");
  ensure(process.env.FABRIC_ENABLED === "false", "Fabric must remain disabled");
  sourceSha = git(["rev-parse", "HEAD"]).trim();
  ensure(
    /^[a-f0-9]{40}$/.test(sourceSha) && process.env.HYBRID_CI_SHA === sourceSha,
    "An exact source SHA is required",
  );
  const input = process.env.TEST_DATABASE_URL;
  ensure(
    input && input === process.env.DATABASE_URL,
    "DATABASE_URL must equal the explicit TEST_DATABASE_URL",
  );
  const url = new URL(input);
  const port = mode === "legacy" ? "25488" : "25489";
  const database = mode === "legacy" ? "/scope_test" : "/browser_test";
  ensure(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.port === port &&
      url.pathname === database &&
      !url.search &&
      !url.hash,
    "Only the reserved loopback test database is permitted",
  );
  // The legacy fixture itself deliberately accepts only this numeric loopback.
  url.hostname = "127.0.0.1";
  return url.href;
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "pipe",
        windowsHide: true,
        timeout: 10000,
      });
    } catch {
      /* The owned process may already have exited. */
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
    await Promise.race([
      new Promise((done) => child.once("exit", done)),
      new Promise((done) => setTimeout(done, 5000)),
    ]);
    if (child.exitCode === null && child.signalCode === null)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
  }
  if (child.exitCode === null && child.signalCode === null)
    await Promise.race([
      new Promise((done) => child.once("exit", done)),
      new Promise((done) => setTimeout(done, 5000)),
    ]);
  ensure(
    child.exitCode !== null || child.signalCode !== null,
    "Owned preparation process did not stop",
  );
}

async function run(label, args, env, cwd = root) {
  stage = label;
  sourceUnchanged();
  const log = join(control, `${label}.log`);
  const fd = openSync(log, "wx", 0o600);
  let child, timer;
  try {
    child = spawn(process.execPath, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    });
    const result = await new Promise((done, reject) => {
      timer = setTimeout(
        () => reject(new Error("Preparation process deadline exceeded")),
        commandDeadlineMs,
      );
      child.once("error", reject);
      child.once("exit", (code) => done(code));
    });
    ensure(
      result === 0,
      "Preparation process failed; inspect retained private logs",
    );
  } finally {
    clearTimeout(timer);
    try {
      if (child) await stop(child);
    } finally {
      closeSync(fd);
    }
  }
  sourceUnchanged();
  return log;
}

function lastJson(log) {
  ensure(
    lstatSync(log).size < 8 * 1024 * 1024,
    "Fixture output exceeded its bound",
  );
  const lines = readFileSync(log, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(-20)
    .reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      /* Diagnostics may precede the receipt. */
    }
  }
  throw new Error("Fixture did not emit a JSON receipt");
}

async function databaseCatalog(env, expectedChecksums) {
  const { Client } = require("pg");
  const db = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  try {
    await db.connect();
    const version = await db.query("SHOW server_version_num");
    ensure(
      Math.trunc(Number(version.rows[0].server_version_num) / 10000) === 18,
      "Isolated preparation requires PostgreSQL 18",
    );
    if (!expectedChecksums) {
      const tables = await db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
      );
      ensure(
        tables.rows.length === 0,
        "Preparation requires a fresh isolated database",
      );
      return;
    }
    const result = await db.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name',
    );
    ensure(
      result.rows.length === Object.keys(expectedChecksums).length,
      "Applied migration count does not match committed catalog",
    );
    for (const row of result.rows)
      ensure(
        row.finished_at !== null &&
          row.rolled_back_at === null &&
          expectedChecksums[row.migration_name] === row.checksum,
        "Applied migration provenance does not match committed catalog",
      );
    return result.rows.length;
  } finally {
    await db.end();
  }
}

function removeStage() {
  if (!stagedCatalog || !existsSync(stagedCatalog)) return true;
  ensure(
    realpathSync(stagedCatalog) === join(control, "staged-catalog") &&
      inside(stagedCatalog, control),
    "Stage cleanup target changed",
  );
  ensure(
    lstatSync(stagedCatalog).isDirectory() &&
      !lstatSync(stagedCatalog).isSymbolicLink(),
    "Stage cleanup target must be owned directory",
  );
  rmSync(stagedCatalog, { recursive: true, force: false });
  return !existsSync(stagedCatalog);
}

function exportBrowserPins(fixture) {
  const pins = fixture.ledgerRoutePins;
  ensure(
    fixture.synthetic === true &&
      Array.isArray(pins) &&
      pins.length === 1 &&
      pins.every(
        (pin) => typeof pin === "string" && /^[a-f0-9]{64}$/.test(pin),
      ) &&
      pins.includes(fixture.activeRouteDigest),
    "Synthetic route fixture emitted invalid pin metadata",
  );
  if (process.env.GITHUB_ENV) {
    const path = process.env.GITHUB_ENV;
    ensure(
      isAbsolute(path) && !lstatSync(path).isSymbolicLink(),
      "GITHUB_ENV must be an existing regular file",
    );
    const fd = openSync(
      path,
      constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      ensure(fstatSync(fd).isFile(), "GITHUB_ENV must be a regular file");
      writeSync(
        fd,
        `LEDGER_ROUTE_PINS=${JSON.stringify(pins)}\nLEDGER_ACTIVE_ROUTE_DIGEST=${fixture.activeRouteDigest}\n`,
      );
    } finally {
      closeSync(fd);
    }
  }
  return {
    ledgerRoutePins: pins,
    activeRouteDigest: fixture.activeRouteDigest,
  };
}

try {
  stage = "input-guards";
  mode = process.argv[2];
  ensure(
    process.argv.length === 3 && ["legacy", "browser"].includes(mode),
    "Expected legacy or browser preparation mode",
  );
  const databaseUrl = isolatedUrl();
  stage = "source-fence";
  sourceUnchanged();
  stage = "migration-catalog";
  const names = git(["ls-tree", "--name-only", `${sourceSha}:${migrationRoot}`])
    .trim()
    .split("\n");
  const migrationNames = names.filter((name) => name !== "migration_lock.toml");
  ensure(
    names.includes("migration_lock.toml") &&
      migrationNames.length === 17 &&
      migrationNames.every((name) => /^\d{14}_[a-z0-9_]+$/.test(name)) &&
      migrationNames[15] === scopeMigration &&
      migrationNames[16] === routeMigration,
    "The expected committed seventeen-migration catalog is required",
  );
  control = privateControl(process.env.HYBRID_CI_CONTROL);
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  };
  const checksums = {};
  const bytesByName = new Map(
    migrationNames.map((name) => {
      const bytes = git(
        ["show", `${sourceSha}:${migrationRoot}/${name}/migration.sql`],
        null,
      );
      checksums[name] = createHash("sha256").update(bytes).digest("hex");
      return [name, bytes];
    }),
  );
  const prisma = require.resolve("prisma/build/index.js");
  stage = "fresh-database-check";
  await databaseCatalog(env);
  let fixture,
    route,
    metadata = {};
  if (mode === "legacy") {
    stagedCatalog = join(control, "staged-catalog");
    mkdirSync(stagedCatalog, { mode: 0o700 });
    writeFileSync(
      join(stagedCatalog, "migration_lock.toml"),
      git(["show", `${sourceSha}:${migrationRoot}/migration_lock.toml`], null),
      { flag: "wx", mode: 0o600 },
    );
    for (const name of migrationNames.slice(0, 16)) {
      mkdirSync(join(stagedCatalog, name), { mode: 0o700 });
      writeFileSync(
        join(stagedCatalog, name, "migration.sql"),
        bytesByName.get(name),
        { flag: "wx", mode: 0o600 },
      );
    }
    const config = join(control, "staged-prisma.config.mjs");
    writeFileSync(
      config,
      `import { defineConfig } from ${JSON.stringify(pathToFileURL(require.resolve("prisma/config")).href)};\nexport default defineConfig({schema:${JSON.stringify(join(api, "prisma/schema.prisma"))},migrations:{path:${JSON.stringify(stagedCatalog)}},datasource:{url:process.env.DATABASE_URL}});\n`,
      { flag: "wx", mode: 0o600 },
    );
    await run(
      "pre-route-migrate",
      [prisma, "migrate", "deploy", "--config", config],
      env,
      api,
    );
    fixture = lastJson(
      await run(
        "legacy-route-seed",
        [
          "--import",
          "tsx",
          join(api, "scripts/seed-isolated-legacy-routes.mjs"),
        ],
        env,
      ),
    );
    ensure(
      fixture.synthetic === true &&
        fixture.events === 28 &&
        fixture.scenarios === 14 &&
        fixture.guardsDisabled === false,
      "Legacy fixture receipt is incomplete",
    );
  }
  await run(
    "official-migrate",
    [prisma, "migrate", "deploy", "--config", join(api, "prisma.config.ts")],
    env,
    api,
  );
  if (mode === "browser") {
    route = lastJson(
      await run(
        "route-fixture",
        [
          "--import",
          "tsx",
          join(api, "scripts/register-isolated-ledger-route.mjs"),
        ],
        env,
      ),
    );
    fixture = { registeredRoutes: route.ledgerRoutePins.length };
    const readiness = lastJson(
      await run(
        "route-readiness",
        [join(api, "scripts/check-hybrid-readiness.mjs")],
        {
          ...env,
          NODE_ENV: "production",
          FABRIC_ENABLED: "false",
          LEDGER_ROUTE_IMPORT_ENABLED: "false",
          APP_RELEASE_SHA: sourceSha,
          LEDGER_ROUTE_PINS: JSON.stringify(route.ledgerRoutePins),
          LEDGER_ACTIVE_ROUTE_DIGEST: route.activeRouteDigest,
        },
      ),
    );
    ensure(
      readiness.result === "passed" &&
        readiness.sourceSha === sourceSha &&
        readiness.readOnly === true &&
        readiness.signingMaterialRead === false &&
        readiness.events === 0 &&
        readiness.sealedLegacyEvents === 0,
      "Fresh runtime route readiness did not pass",
    );
    fixture.readOnlyRuntimeReadiness = true;
  }
  sourceUnchanged();
  stage = "applied-catalog-check";
  const appliedMigrationCount = await databaseCatalog(env, checksums);
  sourceUnchanged();
  if (route) metadata = exportBrowserPins(route);
  const receipt = {
    protocol: "agritrace-hybrid-preparation/1",
    status: "passed",
    mode,
    sourceSha,
    migrationChecksums: checksums,
    appliedMigrationCount,
    fixture,
    ...metadata,
    synthetic: true,
    fabricAcceptance: false,
    sourceUnchanged: true,
    stageCatalogRemoved: removeStage(),
  };
  writeFileSync(
    join(control, "preparation.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(receipt));
} catch {
  let stageCatalogRemoved = false;
  try {
    stageCatalogRemoved = removeStage();
  } catch {
    /* Retain the exact stage on unexpected cleanup target. */
  }
  if (control) {
    try {
      writeFileSync(
        join(control, "preparation.json"),
        JSON.stringify(
          {
            protocol: "agritrace-hybrid-preparation/1",
            status: "failed",
            mode,
            sourceSha,
            stage,
            stageCatalogRemoved,
            synthetic: true,
            fabricAcceptance: false,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    } catch {
      /* Never replace an existing receipt or expose sensitive command output. */
    }
  }
  console.error(
    `Isolated Hybrid preparation failed at ${stage ?? "input-guards"}; inspect guarded inputs and retained private logs.`,
  );
  process.exitCode = 1;
}
