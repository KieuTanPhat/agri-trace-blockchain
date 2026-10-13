import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  privateRestorePath,
  restoreGuards,
  restoreImage,
  validateRestoreReceipt,
  validateRestoreService,
} from "./hybrid-restore-run.mjs";

const sha = "a".repeat(40);
const container = "b".repeat(64);
const scope = "hybrid-ci-1234-2";
const env = {
  GITHUB_ACTIONS: "true",
  NODE_ENV: "test",
  HYBRID_CI_TESTS: "1",
  HYBRID_DRAFT_TESTS: "1",
  FABRIC_ENABLED: "false",
  GITHUB_SHA: sha,
  HYBRID_CI_SHA: sha,
  GITHUB_RUN_ID: "1234",
  GITHUB_RUN_ATTEMPT: "2",
  HYBRID_CI_SCOPE: scope,
  HYBRID_POLICY_CONTAINER: container,
  DATABASE_URL:
    "postgresql://scope_test:isolated-only@127.0.0.1:25488/scope_test",
  TEST_DATABASE_URL:
    "postgresql://scope_test:isolated-only@127.0.0.1:25488/scope_test",
};
const context = { scope, container, source: sha };
const metadata = {
  Id: container,
  Config: {
    Image: restoreImage,
    Labels: { "agritrace.scope": scope + "-policy" },
  },
  HostConfig: {
    Memory: 384 * 1024 ** 2,
    NanoCpus: 10 ** 9,
    Tmpfs: { "/var/lib/postgresql": "rw,size=256m" },
    PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "25488" }] },
    Privileged: false,
    Binds: null,
    Devices: null,
    CapAdd: null,
    NetworkMode: "runner-isolated",
  },
  Mounts: [{ Type: "tmpfs", Destination: "/var/lib/postgresql" }],
  State: { Running: true, OOMKilled: false, Health: "healthy" },
  RestartCount: 0,
};

test("only this exact-SHA test run and its labeled policy service are admitted", () => {
  assert.deepEqual(restoreGuards(env, sha, "linux"), context);
  assert.equal(
    validateRestoreService(structuredClone(metadata), context).Id,
    container,
  );
});

for (const [key, value] of [
  ["GITHUB_ACTIONS", "false"],
  ["NODE_ENV", "production"],
  ["HYBRID_CI_TESTS", "0"],
  ["HYBRID_DRAFT_TESTS", "0"],
  ["FABRIC_ENABLED", "true"],
  ["GITHUB_SHA", "c".repeat(40)],
  ["HYBRID_CI_SHA", "c".repeat(40)],
  ["GITHUB_RUN_ID", "1234;remote"],
  ["GITHUB_RUN_ATTEMPT", "0"],
  ["HYBRID_CI_SCOPE", scope + "-other"],
  ["HYBRID_POLICY_CONTAINER", "postgres"],
  ["DOCKER_HOST", "ssh://production.example"],
  ["DOCKER_CONTEXT", "production"],
  ["DOCKER_TLS_VERIFY", "1"],
  ["DOCKER_CERT_PATH", "/private/docker"],
  ["DOCKER_API_VERSION", "1.45"],
])
  test(`restore refuses ${key} override before Docker or DB access`, () => {
    assert.throws(() => restoreGuards({ ...env, [key]: value }, sha, "linux"));
  });

test("restore refuses Windows/macOS lifecycle even when CI flags are copied", () => {
  for (const platform of ["win32", "darwin"])
    assert.throws(() => restoreGuards(env, sha, platform));
});

for (const url of [
  "postgresql://scope_test:private@production.example:25488/scope_test",
  "postgresql://scope_test:private@127.0.0.1:5432/scope_test",
  "postgresql://scope_test:private@127.0.0.1:25489/browser_test",
  "postgresql://root:private@127.0.0.1:25488/scope_test",
  "postgresql://scope_test:private@127.0.0.1:25488/scope_test?host=production.example",
  "postgresql://scope_test:private@127.0.0.1:25488/scope_test#production",
])
  test(`restore refuses a non-policy connection vector ${new URL(url).hostname}:${new URL(url).port}`, () => {
    assert.throws(() =>
      restoreGuards(
        { ...env, DATABASE_URL: url, TEST_DATABASE_URL: url },
        sha,
        "linux",
      ),
    );
  });

test("mismatching app/test database URLs cannot authorize restore", () => {
  assert.throws(() =>
    restoreGuards({ ...env, DATABASE_URL: "postgresql://other" }, sha, "linux"),
  );
});

for (const [name, mutate] of [
  [
    "different container identity",
    (value) => {
      value.Id = "c".repeat(64);
    },
  ],
  [
    "mutable PostgreSQL tag",
    (value) => {
      value.Config.Image = "postgres:18-alpine";
    },
  ],
  [
    "different job label",
    (value) => {
      value.Config.Labels["agritrace.scope"] = "hybrid-ci-4321-1-policy";
    },
  ],
  [
    "browser service label",
    (value) => {
      value.Config.Labels["agritrace.scope"] = scope + "-browser";
    },
  ],
  [
    "missing memory quota",
    (value) => {
      value.HostConfig.Memory = 0;
    },
  ],
  [
    "wrong CPU quota",
    (value) => {
      value.HostConfig.NanoCpus = 2 * 10 ** 9;
    },
  ],
  [
    "persistent database storage",
    (value) => {
      value.HostConfig.Tmpfs = {};
      value.Mounts = [{ Type: "volume", Destination: "/var/lib/postgresql" }];
    },
  ],
  [
    "missing isolated tmpfs mount",
    (value) => {
      value.Mounts = [];
    },
  ],
  [
    "public database binding",
    (value) => {
      value.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0";
    },
  ],
  [
    "another database port",
    (value) => {
      value.HostConfig.PortBindings["5432/tcp"][0].HostPort = "5432";
    },
  ],
  [
    "additional published port",
    (value) => {
      value.HostConfig.PortBindings["22/tcp"] = [
        { HostIp: "127.0.0.1", HostPort: "2222" },
      ];
    },
  ],
  [
    "privileged service",
    (value) => {
      value.HostConfig.Privileged = true;
    },
  ],
  [
    "host credential mount",
    (value) => {
      value.HostConfig.Binds = ["/private:/private:ro"];
    },
  ],
  [
    "host network",
    (value) => {
      value.HostConfig.NetworkMode = "host";
    },
  ],
  [
    "stopped service",
    (value) => {
      value.State.Running = false;
    },
  ],
  [
    "OOM killed service",
    (value) => {
      value.State.OOMKilled = true;
    },
  ],
  [
    "restarted service",
    (value) => {
      value.RestartCount = 1;
    },
  ],
  [
    "unhealthy service",
    (value) => {
      value.State.Health = "unhealthy";
    },
  ],
])
  test(`restore rejects ${name}`, () => {
    const value = structuredClone(metadata);
    mutate(value);
    assert.throws(() => validateRestoreService(value, context));
  });

const checksums = Object.fromEntries(
  Array.from({ length: 17 }, (_, index) => [
    `migration${index}`,
    "d".repeat(64),
  ]),
);
const receipt = {
  protocol: "agritrace-hybrid-policy/1",
  status: "passed",
  sourceSha: sha,
  postgresMajor: 18,
  appliedMigrationCount: 17,
  migrationChecksums: checksums,
  synthetic: true,
  fabricAcceptance: false,
  sharedDatabaseTouched: false,
  productionResourcesUsed: false,
  sourceUnchanged: true,
  schemaAligned: true,
  uniqueGuards: 6,
  sqlScenarios: 31,
  suites: {
    policy: {
      tests: 132,
      files: 5,
      httpGroups: 26,
      skipped: 0,
      todo: 0,
      failed: 0,
    },
    legacy: {
      tests: 112,
      files: 7,
      httpGroups: 0,
      skipped: 0,
      todo: 0,
      failed: 0,
    },
  },
};

test("restore requires both exact-SHA suites and all official migration checksums", () => {
  assert.equal(validateRestoreReceipt(receipt, sha, checksums), receipt);
  for (const mutation of [
    { status: "failed" },
    { sourceSha: "c".repeat(40) },
    { appliedMigrationCount: 16 },
    { migrationChecksums: { ...checksums, migration16: "f".repeat(64) } },
    { synthetic: false },
    { fabricAcceptance: true },
    { productionResourcesUsed: true },
    { sharedDatabaseTouched: true },
    { sourceUnchanged: false },
    { schemaAligned: false },
    { uniqueGuards: 5 },
  ])
    assert.throws(() =>
      validateRestoreReceipt({ ...receipt, ...mutation }, sha, checksums),
    );
  for (const name of ["policy", "legacy"])
    for (const mutation of [
      { skipped: 1 },
      { failed: 1 },
      { todo: 1 },
      { tests: 0 },
      { files: 0 },
    ])
      assert.throws(() =>
        validateRestoreReceipt(
          {
            ...receipt,
            suites: {
              ...receipt.suites,
              [name]: { ...receipt.suites[name], ...mutation },
            },
          },
          sha,
          checksums,
        ),
      );
});

test("private restore controls are exclusive and cannot escape the job evidence", () => {
  const repo = mkdtempSync(join(tmpdir(), "agritrace-restore-paths-"));
  try {
    const evidence = join(repo, ".codex/evidence/hybrid-ci-a-1");
    mkdirSync(evidence, { recursive: true });
    const control = join(evidence, "restore");
    assert.equal(privateRestorePath(repo, control, evidence, true), control);
    assert.throws(() => privateRestorePath(repo, control, evidence, true));
    for (const bad of [
      join(repo, "production"),
      join(evidence, "../another-job/restore"),
      evidence,
      "relative/restore",
    ])
      assert.throws(() => privateRestorePath(repo, bad, evidence, true));
    const outside = join(repo, "outside");
    mkdirSync(outside);
    symlinkSync(
      outside,
      join(evidence, "symlink"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() =>
      privateRestorePath(
        repo,
        join(evidence, "symlink/restore"),
        evidence,
        true,
      ),
    );
    const file = join(evidence, "file");
    writeFileSync(file, "retained");
    assert.throws(() => privateRestorePath(repo, file, evidence, true));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI lacking CI authorization refuses without exposing connection secrets", () => {
  const script = fileURLToPath(
    new URL("./hybrid-restore-run.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      GITHUB_ACTIONS: "false",
      DATABASE_URL: "postgresql://private-secret@production.example/database",
    },
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert(!result.stderr.includes("private-secret"));
  assert(!result.stderr.includes("production.example"));
});
