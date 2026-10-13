import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalizeRestoreGuards } from "./hybrid-restore-guards.mjs";

const original = {
  kind: "constraint",
  name: "ledger_route_definition.ledger_route_definition_mode_check",
  definition:
    "CHECK (((mode)::text = ANY ((ARRAY['WRITE'::character varying, 'HISTORICAL'::character varying])::text[])))",
  state: "true",
};
const restored = {
  ...original,
  definition:
    "CHECK (((mode)::text = ANY (ARRAY[('WRITE'::character varying)::text, ('HISTORICAL'::character varying)::text])))",
};
const canonical = () => canonicalizeRestoreGuards([original]);

test("known PostgreSQL ARRAY cast pushdown preserves the exact finite CHECK", () => {
  const pairs = [
    [original, restored],
    [
      {
        kind: "constraint",
        name: "certificate.ck_certificate_status",
        definition:
          "CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying])::text[])))",
        state: "true",
      },
      {
        kind: "constraint",
        name: "certificate.ck_certificate_status",
        definition:
          "CHECK (((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('APPROVED'::character varying)::text, ('REJECTED'::character varying)::text])))",
        state: "true",
      },
    ],
    [
      {
        kind: "constraint",
        name: "harvest_sensor_window.harvest_sensor_window_status_check",
        definition:
          "CHECK (((status)::text = ANY ((ARRAY['FINALIZED'::character varying, 'NO_DATA'::character varying])::text[])))",
        state: "true",
      },
      {
        kind: "constraint",
        name: "harvest_sensor_window.harvest_sensor_window_status_check",
        definition:
          "CHECK (((status)::text = ANY (ARRAY[('FINALIZED'::character varying)::text, ('NO_DATA'::character varying)::text])))",
        state: "true",
      },
    ],
    [
      {
        kind: "constraint",
        name: "compliance_assignment_audit.compliance_assignment_audit_action_check",
        definition:
          "CHECK (((action)::text = ANY ((ARRAY['GRANTED'::character varying, 'REVOKED'::character varying])::text[])))",
        state: "true",
      },
      {
        kind: "constraint",
        name: "compliance_assignment_audit.compliance_assignment_audit_action_check",
        definition:
          "CHECK (((action)::text = ANY (ARRAY[('GRANTED'::character varying)::text, ('REVOKED'::character varying)::text])))",
        state: "true",
      },
    ],
    [
      {
        kind: "constraint",
        name: "ledger_route_import.ledger_route_import_environment_check",
        definition:
          "CHECK (((environment)::text = ANY ((ARRAY['production'::character varying, 'isolated'::character varying])::text[])))",
        state: "true",
      },
      {
        kind: "constraint",
        name: "ledger_route_import.ledger_route_import_environment_check",
        definition:
          "CHECK (((environment)::text = ANY (ARRAY[('production'::character varying)::text, ('isolated'::character varying)::text])))",
        state: "true",
      },
    ],
  ];
  for (const [before, after] of pairs) {
    assert.deepEqual(
      canonicalizeRestoreGuards([before]),
      canonicalizeRestoreGuards([after]),
      before.name,
    );
    assert.deepEqual(canonicalizeRestoreGuards([before]), [before]);
  }
});

for (const [name, replacement] of [
  [
    "different allowed value",
    restored.definition.replace("HISTORICAL", "MUTABLE"),
  ],
  [
    "additional allowed value",
    restored.definition.replace("]", ", ('MUTABLE'::character varying)::text]"),
  ],
  [
    "removed allowed value",
    restored.definition.replace(
      ", ('HISTORICAL'::character varying)::text",
      "",
    ),
  ],
  [
    "reordered finite domain",
    restored.definition
      .replace("WRITE", "TEMP")
      .replace("HISTORICAL", "WRITE")
      .replace("TEMP", "HISTORICAL"),
  ],
  [
    "different checked column",
    restored.definition.replace("(mode)", "(network)"),
  ],
  [
    "varchar type modifier",
    restored.definition.replaceAll(
      "character varying",
      "character varying(16)",
    ),
  ],
  [
    "different element type",
    restored.definition.replaceAll("character varying", "text"),
  ],
  [
    "different array cast",
    original.definition.replace("::text[]", "::character varying[]"),
  ],
  [
    "NULL allowed entry",
    restored.definition.replace(
      "('HISTORICAL'::character varying)::text",
      "NULL::text",
    ),
  ],
  [
    "extra boolean condition",
    restored.definition.replace("CHECK (", "CHECK (true OR "),
  ],
  ["different operator", restored.definition.replace("= ANY", "<> ALL")],
  ["NOT VALID definition", restored.definition + " NOT VALID"],
  [
    "trailing unreviewed text",
    restored.definition + " /* ignored by a SQL normalizer */",
  ],
]) {
  test(`rejects ${name} in a reviewed CHECK`, () => {
    assert.throws(
      () =>
        canonicalizeRestoreGuards([{ ...restored, definition: replacement }]),
      /exact finite domain/,
    );
  });
}

test("validation, deferral, enablement and extra guard metadata stay observable", () => {
  for (const mutation of [
    { state: "false" },
    { condeferrable: true },
    { condeferred: true },
    { conenforced: false },
  ]) {
    const guards = canonicalizeRestoreGuards([{ ...restored, ...mutation }]);
    assert.notDeepEqual(guards, canonical());
    for (const [key, value] of Object.entries(mutation))
      assert.equal(guards[0][key], value);
  }
  const trigger = {
    kind: "trigger",
    name: "trace_event.trg_guard",
    definition:
      "CREATE TRIGGER trg_guard BEFORE UPDATE ON trace_event FOR EACH ROW EXECUTE FUNCTION protect_command_commit()",
    state: "O",
  };
  assert.notDeepEqual(
    canonicalizeRestoreGuards([trigger]),
    canonicalizeRestoreGuards([{ ...trigger, state: "D" }]),
  );
});

test("renamed or different-kind guards cannot borrow the whitelist", () => {
  for (const mutation of [
    { name: original.name + "_renamed" },
    { kind: "trigger" },
  ]) {
    const guard = { ...restored, ...mutation };
    assert.deepEqual(canonicalizeRestoreGuards([guard]), [guard]);
    assert.notDeepEqual(canonicalizeRestoreGuards([guard]), canonical());
  }
});

test("unreviewed CHECKs, NOT NULL, indexes and function bodies remain byte-exact", () => {
  const guards = [
    { ...restored, name: "other.mode_check" },
    {
      kind: "constraint",
      name: "lot.quantity_not_null",
      definition: "NOT NULL quantity",
      state: "true",
    },
    {
      kind: "index",
      name: "uq_stage_cycle_active",
      definition:
        "CREATE UNIQUE INDEX uq_stage_cycle_active ON stage_assignment USING btree (cycle_id) WHERE status = 'ACCEPTED'",
      state: "true",
    },
    {
      kind: "function",
      name: "overloaded(integer)",
      definition:
        "CREATE OR REPLACE FUNCTION overloaded(integer) RETURNS boolean LANGUAGE sql AS $f$SELECT true$f$",
      state: "",
    },
  ];
  for (const guard of guards)
    assert.deepEqual(canonicalizeRestoreGuards([guard]), [guard]);
  assert.notDeepEqual(
    canonicalizeRestoreGuards([guards[1]]),
    canonicalizeRestoreGuards([
      { ...guards[1], definition: "NOT NULL network" },
    ]),
  );
  assert.notDeepEqual(
    canonicalizeRestoreGuards([guards[2]]),
    canonicalizeRestoreGuards([
      { ...guards[2], definition: guards[2].definition.replace("UNIQUE ", "") },
    ]),
  );
});

test("guard count, duplicate names and overloaded definitions survive stable ordering", () => {
  const additional = {
    kind: "function",
    name: "fn_check",
    definition:
      "CREATE FUNCTION fn_check(integer) RETURNS bool AS 'select true' LANGUAGE sql",
    state: "",
  };
  const overload = {
    ...additional,
    definition: additional.definition.replace("integer", "text"),
  };
  const guards = [restored, overload, additional, additional];
  const result = canonicalizeRestoreGuards(guards);
  assert.equal(result.length, guards.length);
  assert.deepEqual(result, canonicalizeRestoreGuards([...guards].reverse()));
  assert.notDeepEqual(result, canonicalizeRestoreGuards(guards.slice(1)));
  assert.equal(result.filter((guard) => guard.name === "fn_check").length, 3);
});

test("canonicalization does not mutate input records, order or source files", () => {
  const path = fileURLToPath(
    new URL("./hybrid-restore-guards.mjs", import.meta.url),
  );
  const hash = () =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  const beforeHash = hash();
  const flags = Object.freeze({ required: true });
  const guard = Object.freeze({ ...restored, flags });
  const input = Object.freeze([guard, Object.freeze({ ...original })]);
  const snapshot = JSON.stringify(input);
  const result = canonicalizeRestoreGuards(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(hash(), beforeHash);
  assert.notEqual(result[0], input[0]);
  assert.equal(result.length, input.length);
});

test("invalid, oversized or non-JSON metadata is rejected without silent field loss", () => {
  for (const guards of [
    null,
    {},
    [null],
    [{ ...original, state: undefined }],
    [{ ...original, hidden: undefined }],
    Array(10001).fill(original),
    [{ ...original, hidden: "a".repeat(8 * 1024 * 1024) }],
  ]) {
    assert.throws(() => canonicalizeRestoreGuards(guards));
  }
});

test("stdin CLI prints only canonical records or a bounded generic error", () => {
  const path = fileURLToPath(
    new URL("./hybrid-restore-guards.mjs", import.meta.url),
  );
  const invoke = (input) =>
    spawnSync(process.execPath, [path], {
      input,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
  const result = invoke(JSON.stringify([restored]));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), canonical());
  const rejected = invoke('{"private_guard":"do-not-print-this"}');
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert(!rejected.stderr.includes("do-not-print-this"));
});
