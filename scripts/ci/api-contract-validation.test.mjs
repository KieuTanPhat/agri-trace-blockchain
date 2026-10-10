import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateContract } from "./api-contract-validation.mjs";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../docs/openapi/openapi.json", import.meta.url),
    "utf8",
  ),
);
test("accepts the generated core contract", () =>
  assert.equal(validateContract(fixture), 67));
for (const [name, mutate, message] of [
  [
    "unresolved reference",
    (d) => {
      d.paths["/api/lots"].get.responses["200"].content[
        "application/json"
      ].schema.properties.data = { $ref: "#/components/schemas/Missing" };
    },
    /Unresolved/,
  ],
  [
    "empty response data",
    (d) => {
      d.paths["/api/lots"].get.responses["200"].content[
        "application/json"
      ].schema.properties.data = {};
    },
    /Empty schema/,
  ],
  [
    "empty request schema",
    (d) => {
      d.paths["/api/shipments"].post.requestBody.content[
        "application/json"
      ].schema = {};
    },
    /Empty schema/,
  ],
  [
    "anonymous bypass on secured route",
    (d) => {
      d.paths["/api/lots"].get.security.push({});
    },
    /security metadata/,
  ],
  [
    "unknown auth scheme",
    (d) => {
      d.paths["/api/lots"].get.security = [{ unknown: [] }];
    },
    /Unknown security/,
  ],
  [
    "missing error contract",
    (d) => {
      delete d.paths["/api/lots"].get.responses["400"];
    },
    /error envelope/,
  ],
  [
    "duplicate operationId",
    (d) => {
      d.paths["/api/lots"].get.operationId =
        d.paths["/api/dashboard"].get.operationId;
    },
    /duplicate operationId/,
  ],
  [
    "optional idempotency key",
    (d) => {
      d.paths["/api/shipments"].post.parameters.find(
        (p) => p.name.toLowerCase() === "idempotency-key",
      ).required = false;
    },
    /Idempotency-Key/,
  ],
  [
    "private field in public schema",
    (d) => {
      d.components.schemas.PublicLotDto.properties.passwordHash = {
        type: "string",
      };
    },
    /must not expose/,
  ],
])
  test(`rejects ${name}`, () => {
    const document = structuredClone(fixture);
    mutate(document);
    assert.throws(() => validateContract(document), message);
  });
