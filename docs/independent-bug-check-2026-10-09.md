# Independent bug check — 2026-10-09

Baseline: `18ad14c34855f0a8708de192c1cd36589316f6b2` on `main`.
This review examined current source and reproduced suspected defects without
using the previous cleanup verdict as evidence.

## Confirmed defect and decision

**P2 — Shipment detail returns HTTP 500 for sequenced telemetry.**

`POST /api/iot/shipments/:shipmentId/telemetry` accepts `deviceSequence: 0`
and persists it as PostgreSQL `bigint`. Prisma returns a JavaScript `bigint`.
`ShipmentsService.get` previously returned that value directly, and the normal
NestJS/Express JSON response could not serialize it. The new regression test
failed on the original service with `expected 200, got 500` against an isolated,
migrated PostgreSQL 18 database.

Fix the read projection: convert only `telemetry[].deviceSequence` to its exact
decimal string, preserving `null` for readings without a sequence. Do not use
`Number`, which would lose precision for existing 64-bit values, or a global
JSON serializer, which would change unrelated responses and hashing paths.

| Consideration | Before | After |
| --- | --- | --- |
| Authorized detail request with a sequence | HTTP 500 | HTTP 200 with a decimal string |
| Sequence absent | `null` | `null` |
| Stored sequence | PostgreSQL `bigint` | Same value and type |
| Large sequence precision | Response unavailable | Exact, including `9223372036854775807` |
| Business commands and access policy | Existing behavior | Existing behavior |

**Decision: fix.** The benefit is restoring an existing read endpoint. The
change is local to response projection after authorization, with no migration
or write-path change. Consumers of the sequence field should treat its JSON
value as `string | null`; non-null values previously caused the entire HTTP
response to fail. Swagger generated from the controller describes this field.
Other response metadata remains part of the broader AGT-010 work.

## Scope and impact assessment

Source review covered the cycle/harvest/lot/shipment flow, quantity and version
guards, organization access, login/refresh, idempotency, public trace projection,
IoT ingestion/digests, trace hashing/outbox, Worker receipt handling and the
chaincode validator. Unproven suspicions were not promoted to defects.

The fix changes neither ProductionCycle/Harvest/Lot/Shipment transitions nor
quantity calculations, optimistic versions, idempotency, TraceEvent contents,
outbox delivery, Fabric submission or public trace. It does not alter the
telemetry ingestion contract or implement deferred GPS functionality.

The regression exercises authenticated HTTP ingestion and detail retrieval with
real PostgreSQL persistence. It checks zero and omitted sequences, an existing
maximum 64-bit sequence, exact persistence after retrieval and denial of access
to another organization. A separate test checks the generated Swagger schema.

Relevant ownership and acceptance references remain
[AGT-019](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/31),
[AGT-010](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/22) and
[AGT-029](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/41).
This narrow defect fix does not close those broader tasks or claim their
acceptance criteria are complete.

## Validation

- Before the fix: the new PostgreSQL regression failed with HTTP 500.
- After the fix: the same targeted regression passed. Tests excluded by the
  name filter are not counted as validation.
- `npm run check`: passed on Node 24.19.0/npm 12.1.0. API lint, typecheck and
  build passed; all 86 unit tests and all 59 E2E tests passed. Web typecheck,
  100 tests, lint contract, image optimizer checks and build passed. Chaincode
  typecheck, 34 tests, coverage gates, build and runtime load passed. Gateway
  typecheck, 14 tests, build and runtime load passed.
- `node --test scripts/ci/worker-contract.test.mjs`: passed, using the production
  Worker and the actual chaincode input validator. This is a contract test, not
  a live Fabric network run.
- Three SSH transport tests are platform-skipped on Windows; they are not
  counted as passes. Their Linux execution remains a CI check.
- `git diff --check`: passed. Self-review found no further confirmed defect
  within the reviewed source and exercised paths.

The PostgreSQL databases used for reproduction and verification are dedicated
localhost test databases. Existing developer files and business databases are
not used as test fixtures. A passing run establishes the tested behavior, not
the absence of every possible defect in the project.
