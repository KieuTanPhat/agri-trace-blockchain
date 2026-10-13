import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateVitestReport } from "../scripts/ci/hybrid-policy-run.mjs";
import { canonicalizeRestoreGuards } from "../scripts/ci/hybrid-restore-guards.mjs";

export const restoreImage =
  "postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873";
const root = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const sourcePaths = [
  "apps/api",
  "apps/web",
  "blockchain/gateway",
  "docs/sql",
  "scripts/ci",
  "deploy",
  "package.json",
  "package-lock.json",
  ".github/workflows/application-ci.yml",
];
const dumpLimit = 64 * 1024 * 1024;
const outputLimit = 32 * 1024 * 1024;

export function restoreGuards(env, source, platform = process.platform) {
  assert.equal(
    platform,
    "linux",
    "Restore lifecycle requires an ephemeral Linux runner",
  );
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.HYBRID_CI_TESTS, "1");
  assert.equal(env.HYBRID_DRAFT_TESTS, "1");
  assert.equal(env.FABRIC_ENABLED, "false");
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.equal(env.GITHUB_SHA, source);
  assert.equal(env.HYBRID_CI_SHA, source);
  assert.match(env.GITHUB_RUN_ID ?? "", /^[1-9][0-9]*$/);
  assert.match(env.GITHUB_RUN_ATTEMPT ?? "", /^[1-9][0-9]*$/);
  const scope = `hybrid-ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  assert.equal(env.HYBRID_CI_SCOPE, scope);
  assert.match(env.HYBRID_POLICY_CONTAINER ?? "", /^[a-f0-9]{64}$/);
  for (const key of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "DOCKER_API_VERSION",
  ])
    assert(!env[key], "Remote or overridden Docker transport is refused");
  assert(env.DATABASE_URL && env.DATABASE_URL === env.TEST_DATABASE_URL);
  const url = new URL(env.TEST_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "25488");
  assert.equal(url.pathname, "/scope_test");
  assert.equal(url.username, "scope_test");
  assert.equal(url.search + url.hash, "");
  return { scope, container: env.HYBRID_POLICY_CONTAINER, source };
}

/** Never accept a service by its display name or its currently published port. */
export function validateRestoreService(metadata, context) {
  assert.equal(metadata.Id, context.container);
  assert.equal(metadata.Config.Image, restoreImage);
  assert.equal(
    metadata.Config.Labels["agritrace.scope"],
    `${context.scope}-policy`,
  );
  assert.equal(metadata.HostConfig.Memory, 384 * 1024 ** 2);
  assert.equal(metadata.HostConfig.NanoCpus, 10 ** 9);
  assert.deepEqual(metadata.HostConfig.Tmpfs, {
    "/var/lib/postgresql": "rw,size=256m",
  });
  assert.deepEqual(metadata.HostConfig.PortBindings, {
    "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "25488" }],
  });
  assert.equal(metadata.HostConfig.Privileged, false);
  assert(
    !metadata.HostConfig.Binds?.length &&
      !metadata.HostConfig.Devices?.length &&
      !metadata.HostConfig.CapAdd?.length,
  );
  assert(!["host", "none"].includes(metadata.HostConfig.NetworkMode));
  assert.equal(metadata.Mounts.length, 1);
  assert(
    metadata.Mounts.every(
      (mount) =>
        mount.Type === "tmpfs" && mount.Destination === "/var/lib/postgresql",
    ),
  );
  assert.equal(metadata.State.Running, true);
  assert.equal(metadata.State.OOMKilled, false);
  assert.equal(metadata.State.Health, "healthy");
  assert.equal(metadata.RestartCount, 0);
  return metadata;
}

function inside(child, parent) {
  const suffix = relative(parent, child);
  return (
    suffix &&
    suffix !== ".." &&
    !suffix.startsWith(`..${sep}`) &&
    !isAbsolute(suffix)
  );
}

export function privateRestorePath(repo, value, jobEvidence, create = false) {
  assert(value && isAbsolute(value));
  const destination = resolve(value);
  assert(
    inside(destination, jobEvidence),
    "Restore paths must remain inside this job's evidence",
  );
  assert(inside(jobEvidence, join(repo, ".codex/evidence")));
  let current = repo;
  for (const component of relative(repo, destination).split(sep)) {
    current = join(current, component);
    if (existsSync(current))
      assert(
        !lstatSync(current).isSymbolicLink(),
        "Symlink restore path refused",
      );
  }
  assert.equal(
    realpathSync(dirname(destination)),
    resolve(dirname(destination)),
  );
  if (create) mkdirSync(destination, { recursive: false, mode: 0o700 });
  return destination;
}

export function validateRestoreReceipt(receipt, source, checksums) {
  assert.equal(receipt.protocol, "agritrace-hybrid-policy/1");
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.sourceSha, source);
  assert.equal(receipt.postgresMajor, 18);
  assert.equal(receipt.appliedMigrationCount, 17);
  assert.deepEqual(receipt.migrationChecksums, checksums);
  assert.equal(receipt.synthetic, true);
  assert.equal(receipt.fabricAcceptance, false);
  assert.equal(receipt.sharedDatabaseTouched, false);
  assert.equal(receipt.productionResourcesUsed, false);
  assert.equal(receipt.sourceUnchanged, true);
  assert.equal(receipt.schemaAligned, true);
  assert.equal(receipt.uniqueGuards, 6);
  assert.equal(receipt.sqlScenarios, 31);
  for (const [name, tests, files, httpGroups] of [
    ["policy", 132, 5, 26],
    ["legacy", 112, 7, 0],
  ])
    assert.deepEqual(receipt.suites[name], {
      tests,
      files,
      httpGroups,
      skipped: 0,
      todo: 0,
      failed: 0,
    });
  return receipt;
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 30000,
    maxBuffer: outputLimit,
  });
}
function unchanged(source) {
  assert.equal(git("rev-parse", "HEAD").toString("utf8").trim(), source);
  git(
    "ls-files",
    "--error-unmatch",
    "deploy/hybrid-restore-run.mjs",
    "deploy/hybrid-restore-run.test.mjs",
    "scripts/ci/hybrid-restore-guards.mjs",
  );
  git("diff", "--exit-code", "--no-ext-diff", source, "--", ...sourcePaths);
  assert.equal(
    git("ls-files", "--others", "--exclude-standard", "--", ...sourcePaths)
      .toString("utf8")
      .trim(),
    "",
  );
}
function migrationChecksums(source) {
  const paths = git(
    "ls-tree",
    "-r",
    "--name-only",
    source,
    "--",
    "apps/api/prisma/migrations",
  )
    .toString("utf8")
    .trim()
    .split("\n")
    .filter((file) => file.endsWith("/migration.sql"));
  assert.equal(paths.length, 17);
  return Object.fromEntries(
    paths.map((file) => [
      file.split("/").at(-2),
      createHash("sha256")
        .update(git("show", `${source}:${file}`))
        .digest("hex"),
    ]),
  );
}
function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
function readJson(file, jobEvidence, limit = 16 * 1024 * 1024) {
  privateRestorePath(root, file, jobEvidence);
  const metadata = lstatSync(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= limit,
  );
  assert.equal(metadata.mode & 0o022, 0);
  return JSON.parse(readFileSync(file, "utf8"));
}
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const schemaQuery = `SELECT coalesce(json_agg(x ORDER BY x.kind COLLATE "C",x.name COLLATE "C",x.definition COLLATE "C",x.state COLLATE "C"),'[]'::json)::text FROM (
 SELECT 'trigger' AS kind,c.relname||'.'||t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,t.tgenabled::text AS state,NULL::text AS predicate
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL SELECT 'constraint',c.relname||'.'||p.conname,pg_get_constraintdef(p.oid),
 jsonb_build_object('validated',p.convalidated,'enforced',p.conenforced,'deferrable',p.condeferrable,'deferred',p.condeferred,'noInherit',p.connoinherit)::text,NULL
 FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid),'',NULL
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
 UNION ALL SELECT 'index',c.relname||'.'||i.relname,pg_get_indexdef(p.indexrelid),
 jsonb_build_object('valid',p.indisvalid,'ready',p.indisready,'unique',p.indisunique,'live',p.indislive,'primary',p.indisprimary,'nullsNotDistinct',p.indnullsnotdistinct,'immediate',p.indimmediate)::text,pg_get_expr(p.indpred,p.indrelid)
 FROM pg_index p JOIN pg_class c ON c.oid=p.indrelid JOIN pg_class i ON i.oid=p.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') x;`;

function requireUniqueGuards(guards) {
  const names = [
    "sensor_digest.uq_sensor_digest_window",
    "sensor_digest.ux_sensor_digest_final_cycle",
    "shipment_tracking_binding.ux_tracking_binding_active_device",
    "stage_assignment.uq_stage_cycle_active",
    "stage_assignment.uq_stage_lot_active",
    "stage_assignment.uq_stage_shipment_active",
  ];
  for (const name of names) {
    const index = guards.find(
      (guard) => guard.kind === "index" && guard.name === name,
    );
    assert(index);
    const state = JSON.parse(index.state);
    assert(state.unique && state.valid && state.ready && state.live);
    if (name !== names[0]) assert(index.predicate);
  }
  return names.length;
}

async function main() {
  const source = git("rev-parse", "HEAD").toString("utf8").trim();
  const context = restoreGuards(process.env, source);
  assert.equal(realpathSync(process.env.GITHUB_WORKSPACE), root);
  const evidence = resolve(process.env.HYBRID_CI_EVIDENCE ?? "");
  assert.equal(
    evidence,
    join(
      root,
      ".codex/evidence",
      `hybrid-ci-${source}-${process.env.GITHUB_RUN_ATTEMPT}`,
    ),
  );
  assert(statSync(evidence).isDirectory());
  const control = privateRestorePath(
    root,
    process.env.HYBRID_RESTORE_CONTROL ?? join(evidence, "legacy-restore"),
    evidence,
    true,
  );
  let stage = "policy-receipts";
  const docker = (args, options = {}) => {
    const label = stage;
    const diagnostics = join(control, `${label}-${++sequence}.private.log`);
    const fd = openSync(diagnostics, "wx", 0o600);
    try {
      return execFileSync("docker", ["--context", "default", ...args], {
        cwd: root,
        env: process.env,
        input: options.input,
        stdio: [
          options.input === undefined ? "ignore" : "pipe",
          options.output ?? "pipe",
          fd,
        ],
        timeout: options.timeout ?? 90000,
        maxBuffer: outputLimit,
        windowsHide: true,
      });
    } finally {
      closeSync(fd);
    }
  };
  let sequence = 0;
  // Inspect only ownership/resource fields; container environment/passwords and
  // healthcheck diagnostic output never enter this runner's metadata.
  const inspectTemplate =
    '{"Id":{{json .Id}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},"HostConfig":{"Memory":{{json .HostConfig.Memory}},"NanoCpus":{{json .HostConfig.NanoCpus}},"Tmpfs":{{json .HostConfig.Tmpfs}},"PortBindings":{{json .HostConfig.PortBindings}},"Privileged":{{json .HostConfig.Privileged}},"Binds":{{json .HostConfig.Binds}},"Devices":{{json .HostConfig.Devices}},"CapAdd":{{json .HostConfig.CapAdd}},"NetworkMode":{{json .HostConfig.NetworkMode}}},"Mounts":{{json .Mounts}},"State":{"Running":{{json .State.Running}},"OOMKilled":{{json .State.OOMKilled}},"Health":{{json .State.Health.Status}}},"RestartCount":{{json .RestartCount}}}';
  const inspect = () =>
    validateRestoreService(
      JSON.parse(
        docker([
          "inspect",
          "--format",
          inspectTemplate,
          context.container,
        ]).toString("utf8"),
      ),
      context,
    );
  const sql = (database, query, readOnly = true) => {
    const prefix = readOnly ? "BEGIN READ ONLY;" : "BEGIN;";
    return docker(
      [
        "exec",
        "-i",
        "--user",
        "postgres",
        context.container,
        "psql",
        "--no-psqlrc",
        "-U",
        "scope_test",
        "-d",
        database,
        "-Atq",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: `${prefix} SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL search_path=public,pg_catalog; ${query} ROLLBACK;`,
      },
    )
      .toString("utf8")
      .trim();
  };
  const fingerprint = (database, label) => {
    stage = label;
    const names = JSON.parse(
      sql(
        database,
        "SELECT coalesce(json_agg(tablename ORDER BY tablename COLLATE \"C\"),'[]'::json) FROM pg_tables WHERE schemaname='public';",
      ),
    );
    assert(names.length > 0 && names.length <= 128);
    const tables = {};
    for (const table of names) {
      assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
      const raw = sql(
        database,
        `SELECT coalesce(json_agg(row_json ORDER BY row_json::text COLLATE "C"),'[]'::json)::text FROM (SELECT to_jsonb(t) AS row_json FROM public."${table}" t) rows;`,
      );
      tables[table] = { rows: JSON.parse(raw).length, sha256: hash(raw) };
    }
    const guards = JSON.parse(sql(database, schemaQuery));
    assert.equal(
      new Set(guards.map((guard) => guard.kind + ":" + guard.name)).size,
      guards.length,
    );
    const canonical = canonicalizeRestoreGuards(guards);
    const byId = new Map(
      canonical.map((guard) => [guard.kind + ":" + guard.name, guard]),
    );
    const normalized = guards
      .filter(
        (guard) =>
          guard.definition !==
          byId.get(guard.kind + ":" + guard.name).definition,
      )
      .map((guard) => guard.name);
    const result = {
      tables,
      schemaGuards: {
        count: guards.length,
        canonicalSha256: hash(JSON.stringify(canonical)),
      },
    };
    writeJson(join(control, `${label}-guards.private.json`), guards);
    writeJson(join(control, `${label}-canonical.private.json`), canonical);
    writeJson(join(control, `${label}-fingerprints.private.json`), result);
    return { result, normalized, uniqueGuards: requireUniqueGuards(canonical) };
  };
  try {
    unchanged(source);
    const checksums = migrationChecksums(source);
    const policyFile =
      process.env.HYBRID_RESTORE_POLICY ??
      join(evidence, "legacy-policy/policy-run.json");
    validateRestoreReceipt(readJson(policyFile, evidence), source, checksums);
    for (const [name, expected] of [
      ["policy", { tests: 132, files: 5, httpGroups: 26 }],
      ["legacy", { tests: 112, files: 7 }],
    ])
      validateVitestReport(
        readJson(join(dirname(policyFile), `${name}.private.json`), evidence),
        expected,
      );
    const services = readJson(join(evidence, "services.json"), evidence);
    assert.equal(services.sourceSha, source);
    assert.equal(services.scope, context.scope);
    assert.equal(services.productionResourcesUsed, false);
    assert(
      services.services.some(
        (service) =>
          service.role === "policy" &&
          service.id === context.container &&
          service.image === restoreImage,
      ),
    );
    stage = "service-admission";
    const [daemon] = JSON.parse(
      docker(["context", "inspect", "default"]).toString("utf8"),
    );
    assert.equal(daemon.Endpoints.docker.Host, "unix:///var/run/docker.sock");
    inspect();
    const uid = docker([
      "exec",
      "--user",
      "postgres",
      context.container,
      "id",
      "-u",
    ])
      .toString("utf8")
      .trim();
    assert.match(uid, /^[1-9][0-9]*$/);
    assert.equal(
      docker(["exec", "--user", "postgres", context.container, "id", "-un"])
        .toString("utf8")
        .trim(),
      "postgres",
    );
    assert.equal(
      Math.trunc(Number(sql("scope_test", "SHOW server_version_num;")) / 10000),
      18,
    );
    assert.equal(
      sql(
        "scope_test",
        "SELECT count(*) FROM pg_database WHERE datname='scope_restore';",
      ),
      "0",
    );
    const catalog = JSON.parse(
      sql(
        "scope_test",
        "SELECT json_agg(json_build_object('name',migration_name,'checksum',checksum,'complete',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name) FROM _prisma_migrations;",
      ),
    );
    assert.equal(catalog.length, 17);
    for (const migration of catalog) {
      assert(migration.complete && !migration.rolledBack);
      assert.equal(checksums[migration.name], migration.checksum);
    }
    const before = fingerprint("scope_test", "before");
    assert(
      before.result.tables.trace_event.rows > 0 &&
        before.result.tables.ledger_route_legacy_requirement.rows > 0 &&
        before.result.tables.ledger_route_definition.rows > 0,
    );
    stage = "pg-dump";
    inspect();
    const dump = join(control, "synthetic-scope.private.dump");
    const dumpFd = openSync(dump, "wx", 0o600);
    try {
      docker(
        [
          "exec",
          "--user",
          "postgres",
          context.container,
          "pg_dump",
          "-U",
          "scope_test",
          "-d",
          "scope_test",
          "-Fc",
          "--no-owner",
          "--no-acl",
        ],
        { output: dumpFd, timeout: 240000 },
      );
    } finally {
      closeSync(dumpFd);
    }
    assert(statSync(dump).size > 0 && statSync(dump).size < dumpLimit);
    const snapshot = readFileSync(dump);
    assert.equal(snapshot.subarray(0, 5).toString("ascii"), "PGDMP");
    stage = "fresh-restore";
    unchanged(source);
    inspect();
    docker([
      "exec",
      "--user",
      "postgres",
      context.container,
      "createdb",
      "-U",
      "scope_test",
      "--template=template0",
      "scope_restore",
    ]);
    docker(
      [
        "exec",
        "-i",
        "--user",
        "postgres",
        context.container,
        "pg_restore",
        "-U",
        "scope_test",
        "-d",
        "scope_restore",
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
      ],
      { input: snapshot, timeout: 240000 },
    );
    const after = fingerprint("scope_restore", "after");
    assert.deepEqual(after.result, before.result);
    stage = "restored-mutation-refusal";
    const refusal = sql(
      "scope_restore",
      `DO $$BEGIN
      BEGIN UPDATE ledger_route_definition SET network=network WHERE digest=(SELECT digest FROM ledger_route_definition LIMIT 1); RAISE EXCEPTION 'Guard did not refuse';
      EXCEPTION WHEN OTHERS THEN IF position('immutable' IN lower(SQLERRM))=0 THEN RAISE; END IF; END;
      BEGIN DELETE FROM ledger_route_legacy_requirement WHERE event_id=(SELECT event_id FROM ledger_route_legacy_requirement LIMIT 1); RAISE EXCEPTION 'Guard did not refuse';
      EXCEPTION WHEN OTHERS THEN IF position('sealed' IN lower(SQLERRM))=0 THEN RAISE; END IF; END;
      END; $$; SELECT json_build_object('restoredGuards',2,'passed',true);`,
      false,
    );
    assert.deepEqual(JSON.parse(refusal), { restoredGuards: 2, passed: true });
    const checked = fingerprint("scope_restore", "after-refusal");
    const original = fingerprint("scope_test", "original-final");
    assert.deepEqual(checked.result, before.result);
    assert.deepEqual(original.result, before.result);
    stage = "complete";
    inspect();
    unchanged(source);
    const receipt = {
      protocol: "agritrace-hybrid-restore/1",
      status: "passed",
      sourceSha: source,
      scope: context.scope,
      postgresMajor: 18,
      appliedMigrationCount: catalog.length,
      migrationChecksums: checksums,
      databaseTables: Object.keys(before.result.tables).length,
      rowsCompared: Object.values(before.result.tables).reduce(
        (total, table) => total + table.rows,
        0,
      ),
      schemaGuardsCompared: before.result.schemaGuards.count,
      uniqueGuards: checked.uniqueGuards,
      normalizedCheckForms: {
        before: before.normalized,
        after: after.normalized,
      },
      restoredGuards: 2,
      snapshotSha256: hash(snapshot),
      snapshotBytes: snapshot.length,
      originalDatabaseUnchanged: true,
      restoredDatabaseMatches: true,
      sourceUnchanged: true,
      synthetic: true,
      productionCopy: false,
      productionResourcesUsed: false,
      sharedDatabaseTouched: false,
      databaseLifecycle: "owned-service-removed-by-parent-job",
      at: new Date().toISOString(),
    };
    writeJson(join(control, "restore-run.json"), receipt);
    console.log(JSON.stringify(receipt));
  } catch {
    writeJson(join(control, "restore-failure.json"), {
      protocol: "agritrace-hybrid-restore/1",
      status: "failed",
      sourceSha: source,
      stage,
      synthetic: true,
      productionCopy: false,
      productionResourcesUsed: false,
    });
    throw new Error(
      "Isolated restore acceptance failed; private diagnostics retained",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    assert.equal(process.argv.length, 2);
    await main();
  } catch {
    console.error(
      "Isolated CI backup/restore refused or failed; no database/container secrets are printed.",
    );
    process.exitCode = 1;
  }
}
