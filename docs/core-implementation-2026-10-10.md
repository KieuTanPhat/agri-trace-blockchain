# Core implementation — 10/10/2026

Status: implementation in progress on `codex/core-completion`, based on
`9e228b7c236d9527727b496849d07ca2d160d04f`. This document is an implementation
record, not task acceptance or release approval.

## Foundation implemented

- Business/masterdata POST commands enter `executeCommand`: authoritative
  account/session/role/org checks before start and replay; authorization is
  checked again under organization → user shared locks in the domain transaction.
- Each command writes an immutable `CommandCommit` with its response and resource
  IDs in the same PostgreSQL transaction. An uncertain PROCESSING request is
  replayed only when its journal positively establishes the original commit.
  Legacy keys without authorization scope require reconciliation. TTL never
  grants permission to execute an uncertain request again.
- Decimal3 quantities and full movement-chain reconciliation protect shipment
  creation, transport transitions and quantity mutations. Cycle mutations share
  one aggregate lock; Lot/Shipment commands share a Lot lock.
- `COMPLIANCE_REVIEWER` belongs to an active AUDITOR organization. Admin grants
  and revokes Farm assignments with immutable audit records. Reviewer reads of
  cycles, Lots, shipments and trace/proofs use only assigned Farms. Compliance
  write activation/correction is a later implementation step.
- Every new harvest finalizes a separate sensor window, atomically with its Lot,
  QR, movement, trace and outbox. First window includes plantedAt; later windows
  exclude the previous cutoff. NO_DATA stores no synthetic hash. Membership is
  unique per reading and sealed in the same transaction. Raw readings, windows,
  digests and movements have database audit protections.
- Late readings remain raw and receive a separate marker. Legacy harvests or
  missing plantedAt block continuation until an Admin appends an audited
  reconciliation; existing records/hashes are never rewritten.
- Fabric writes use envelope 3.0.0 with nonce=eventId. Private trace hash 2.0.0 /
  RFC8785 is unchanged. Actor/auth evidence and business payload remain private.
  Chaincode reads old ledger records and rejects non-v3 writes. Duplicate
  recovery compares the complete public tuple, including the original proof.
- Worker validates private hash/evidence and sensor membership, then validates
  committed ledger proof, channel, transaction ID and recording time before
  CONFIRMED. A chaincode capability mismatch prevents claiming new outbox jobs.
- Public trace responses use `Cache-Control: no-store`.

## Commands added

- `GET/POST /api/compliance/assignments`; `POST /api/compliance/assignments/:id/revoke`.
- `POST /api/production-cycles/:id/sensor-reconciliations`: Admin, Idempotency-Key,
  current cycle version, plantedAt, latest legacy throughHarvestId (if present),
  and a nonblank reason. Only before the first new sensor window is finalized.
- After reviewed schema deployment, provision the additional role with
  `npm run db:provision-compliance-role --workspace apps/api`. This narrow script
  only inserts a missing role; it is not demo seed. It has not been run here.

NestJS Swagger remains the API contract. The OpenAPI exporter/type generation
and all new business/UI flows still require their own implementation gates.

## Controlled deployment required

New migrations contain audit triggers, deferred constraints and partial unique
indexes. They intentionally require the existing controlled SQL review/rehearsal
gate. Do not relax `deploy/cd/policy.py`, edit applied migrations, reset/seed a
shared database or delete unresolved idempotency/outbox records.

First v3 cutover: encrypted consistent snapshot → stop old Worker → upgrade
chaincode to a higher sequence and verify both peers → reviewed migrations and
role provision → compatible API/Worker/Web → canary and queue drain. Older
Worker/API images that write v2 envelopes or omit windows/journals are not
rollback candidates. Preserve DB/outbox/ledger; pause affected writes and fix
forward when no compatible rollback image exists.

## Evidence so far

- Dependencies installed in the isolated worktree with Node 24.15.0/npm 12.1.0;
  npm ci reported 0 vulnerabilities.
- Intermediate API/Web TypeScript checks, API lint, Gateway build and chaincode
  TypeScript checks passed. Final checks must be repeated after subsequent edits.
- No application test suites, database migrations, role provision, Fabric
  transactions, deployment or acceptance changes have been performed.
- Runtime stability above 99%, complete core acceptance and RC/UAT readiness
  have not been established. Follow the plan gates and record actual evidence.

## Remaining work

Compliance write/correction, Farm damage, sale/recall/expiry commands and UI,
sensor/public warnings, complete Swagger/exported types and drift gate, release
capability checks, reconciliation tooling, integration/recovery/mobile/UAT
evidence, DOCX/Sheet handoff and human acceptance remain in the ordered plan.

See [the approved plan](plans/core-completion-plan-2026-10-10.md).
