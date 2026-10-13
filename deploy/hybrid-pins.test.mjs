import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonicalSha256 } from "../apps/api/dist/common/crypto/rfc8785.js";
import { buildLegacyScopeAssignmentPlan } from "../apps/api/dist/modules/supply-chains/legacy-scope-plan.js";

const root = path.resolve(import.meta.dirname, "..");
const sha = "a".repeat(40);
function check(pins) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "agritrace-pin-validator-"),
  );
  try {
    const file = path.join(directory, "pins.json");
    writeFileSync(
      file,
      JSON.stringify({ schema: "agritrace-legacy-scope-pins-1", pins }),
      { mode: 0o600 },
    );
    const before = readFileSync(file);
    const result = spawnSync(
      process.execPath,
      [path.join(root, "apps/api/scripts/check-hybrid-pins.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: "production",
          APP_RELEASE_SHA: sha,
          HYBRID_LEGACY_MANIFEST_PINS_FILE: file,
          LEDGER_ROUTE_PINS: JSON.stringify(["b".repeat(64)]),
          LEDGER_ACTIVE_ROUTE_DIGEST: "b".repeat(64),
          LEDGER_ROUTE_IMPORT_PINS: "[]",
          LEDGER_PAUSED_WRITER_PINS: "[]",
          DATABASE_URL: "invalid-database-url-must-never-be-used",
          FABRIC_ENABLED: "false",
        },
      },
    );
    assert.deepEqual(
      readFileSync(file),
      before,
      "Read-only preflight must preserve the pin file",
    );
    return result;
  } finally {
    // Only the exact unique directory returned by mkdtemp is removed.
    assert(path.basename(directory).startsWith("agritrace-pin-validator-"));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    rmSync(directory, { recursive: true });
  }
}
function validPin() {
  const body = { schema: "agritrace-legacy-inventory-1", roots: [] };
  const inventory = { ...body, digest: canonicalSha256(body) };
  const expected = { environment: "production", sourceSha: sha };
  const manifest = {
    schema: "agritrace-legacy-scope-manifest-1",
    id: randomUUID(),
    ...expected,
    inventoryDigest: inventory.digest,
    operatorId: randomUUID(),
    reviewerId: randomUUID(),
    reviewEvidenceDigest: "c".repeat(64),
    entries: [],
  };
  const digest = canonicalSha256(manifest);
  const plan = buildLegacyScopeAssignmentPlan(
    manifest,
    inventory,
    digest,
    expected,
    [],
  );
  return { manifest, digest, plan };
}

test("runtime preflight accepts an empty set and canonical production manifest/plan without accessing DB", () => {
  for (const pins of [[], [validPin()]]) {
    const result = check(pins);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout.trim());
    assert.equal(receipt.legacyPinCount, pins.length);
    assert.equal(receipt.sourceSha, sha);
    assert.equal(receipt.databaseAccessed, false);
    assert.equal(receipt.signingMaterialRead, false);
  }
});

test("runtime preflight rejects malformed, changed and duplicate legacy pins before cutover", () => {
  const pin = validPin();
  for (const pins of [
    [{ manifest: { environment: "production" } }],
    [{ ...pin, digest: "0".repeat(64) }],
    [{ ...pin, plan: { ...pin.plan, manifestId: randomUUID() } }],
    [pin, pin],
  ]) {
    const result = check(pins);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Hybrid metadata validation failed;/);
    assert.equal(
      result.stderr.includes(pin.manifest.id),
      false,
      "Diagnostics must not expose metadata contents",
    );
  }
});
