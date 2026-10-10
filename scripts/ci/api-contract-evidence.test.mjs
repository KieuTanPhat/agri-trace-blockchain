import { test } from "node:test";
import assert from "node:assert/strict";
import { compareContracts } from "./api-contract-evidence.mjs";

test("flags removed routes, changed security and indirect schema changes", () => {
  const base = {
    paths: {
      "/lots": { get: { operationId: "lots", security: [{ bearer: [] }] } },
    },
    components: { schemas: { Lot: { type: "string" } } },
  };
  assert.equal(compareContracts(base, base).length, 0);
  assert.equal(
    compareContracts(base, { ...base, paths: {} })[0].kind,
    "operation-changed-or-removed",
  );
  assert.equal(
    compareContracts(base, {
      ...base,
      paths: { "/lots": { get: { operationId: "lots", security: [] } } },
    }).length,
    1,
  );
  assert.equal(
    compareContracts(base, {
      ...base,
      components: { schemas: { Lot: { type: "number" } } },
    })[0].kind,
    "component-changed-or-removed",
  );
  assert.equal(
    compareContracts(base, {
      ...base,
      paths: { ...base.paths, "/new": { get: { operationId: "new" } } },
    }).length,
    0,
  );
});

test("flags inherited path parameters and global authentication/server changes", () => {
  const base = { paths: { "/lots": { get: { operationId: "lots" } } } };
  const changed = structuredClone(base);
  changed.paths["/lots"].parameters = [
    { name: "scope", in: "query", required: true },
  ];
  assert.equal(
    compareContracts(base, changed)[0].kind,
    "path-contract-changed",
  );
  for (const field of ["security", "servers", "openapi"]) {
    assert.equal(
      compareContracts(base, { ...base, [field]: "changed" })[0].kind,
      "document-contract-changed",
    );
  }
});

test("ignores property ordering without ignoring array ordering or scalar differences", () => {
  const base = {
    paths: { "/lots": { get: { operationId: "lots", summary: "List" } } },
  };
  const reordered = {
    paths: { "/lots": { get: { summary: "List", operationId: "lots" } } },
  };
  assert.deepEqual(compareContracts(base, reordered), []);
});
