# Current architecture context for Graphify

Reviewed against the working tree on 2026-10-04. This document describes source
behavior, including the current staged refactor. Runtime source, Prisma schema
and committed PostgreSQL migrations take precedence over this summary. Review
this document again when its linked evidence changes; the Graphify wrapper checks
those evidence hashes before reusing its semantic layer.

## Source boundaries

The repository contains four workspaces: NestJS API, Next.js Web, Fabric chaincode
and Fabric gateway. API and blockchain worker are separate processes from one
backend codebase. PostgreSQL is the business store and outbox delivery boundary.
See [Compose](../docker-compose.yml), [API composition](../apps/api/src/app.module.ts),
[worker composition](../apps/api/src/worker/worker.module.ts),
[architecture decision](adr-001-modular-monolith-dedicated-worker.md) and
[frontend architecture](../apps/web/ARCHITECTURE.md).

The browser communicates with HTTP endpoints; it does not directly call NestJS
methods. The worker consumes persisted outbox rows; an API command does not
directly call the worker. Fabric transaction names are a network dispatch
boundary, not ordinary TypeScript calls. Represent these as HTTP, data or
contract relationships. Do not invent direct `calls` edges across processes.

## Authentication and refresh

[Web auth API](../apps/web/src/features/auth/api.ts) uses the shared
[HTTP client](../apps/web/src/shared/api/http-client.ts) to call `/auth/login`
and `/auth/me`. The client shares one refresh promise, calls `/auth/refresh`
after an authenticated 401, retries once and checks the session owner before
accepting responses.

[AuthController](../apps/api/src/modules/auth/auth.controller.ts) delegates to
[AuthService](../apps/api/src/modules/auth/auth.service.ts). Login checks the
stored password hash and ACTIVE account status. Refresh hashes the supplied
token, verifies the stored session and revokes/replaces it in a transaction.
The JWT guard reads current account/role information from the database.
See [JwtAuthGuard](../apps/api/src/modules/auth/jwt-auth.guard.ts).

## Harvest and lot creation

[LotsController](../apps/api/src/modules/lots/lots.controller.ts) exposes
`POST production-cycles/:cycleId/harvests` for SYSTEM_ADMIN and FARM_STAFF,
with the existing idempotency mechanism.
[LotsService](../apps/api/src/modules/lots/lots.service.ts) delegates to
[RecordHarvestService](../apps/api/src/modules/lots/record-harvest.service.ts).

`recordHarvest` checks production-cycle access and the PLANTED/GROWING state,
checks the quantity limit, and performs one Serializable transaction. That
transaction creates HarvestEvent, Lot, HARVEST_RECORDED TraceEvent,
BlockchainOutbox, HARVEST_IN QuantityMovement and TraceQr. The optional final
sensor digest must belong to the cycle and have `isFinal=true` if supplied;
this method does not automatically flush/finalize sensor readings.

[TraceService](../apps/api/src/modules/trace/trace.service.ts) receives the same
transaction client. It locks the entity hash-chain head, derives the predecessor
by hash links, calculates the canonical hash, creates the event and queues one
PENDING outbox row. [Trace hash](../apps/api/src/modules/trace/trace-hash.ts)
defines the hash input. Successful business persistence can precede Fabric
confirmation.

The current model is ProductionCycle -> HarvestEvent -> Lot -> Shipment,
as defined in [Prisma](../apps/api/prisma/schema.prisma). A cycle can have
multiple harvest events. Lot has a unique harvest reference, and Shipment has
a unique lot reference in this core model. The historical Batch state machine
in `business-specification-v1.2.md` is not current implementation evidence.

## Outbox delivery and Fabric confirmation

[BlockchainWorkerRunner](../apps/api/src/modules/blockchain-adapter/blockchain-worker.runner.ts)
drives [BlockchainWorkerService](../apps/api/src/modules/blockchain-adapter/blockchain-worker.service.ts).
The service claims due rows with `FOR UPDATE SKIP LOCKED`, a lease token and
predecessor confirmation ordering. It submits through the application port
[BlockchainAdapterFactory](../apps/api/src/common/ports/blockchain.port.ts).

NestJS wiring in [WorkerModule](../apps/api/src/worker/worker.module.ts) maps
BLOCKCHAIN_ADAPTER_FACTORY to FabricAdapterProvider with `useExisting`.
[FabricAdapterProvider](../apps/api/src/modules/blockchain-adapter/fabric-adapter.provider.ts)
creates a connection lazily and wraps
[FabricTraceAdapter](../apps/api/src/modules/blockchain-adapter/fabric-trace.adapter.ts).
The latter delegates to
[FabricBlockchainAdapter](../blockchain/gateway/src/adapter.ts), whose
`submitTransaction("RecordTraceEvent", ...)` reaches
[AgriTraceContract](../blockchain/chaincode/src/traceability-contract.ts).

The submitted contract version is `2.0.0` with `RFC8785` canonicalization.
A confirmed receipt must have a transaction ID, matching data hash and valid
recording time. Outbox completion and CONFIRMED BlockchainProof persistence
occur in one transaction only while the same lease is held. Permanent failures
or exhausted retries become DEAD_LETTER. Delivery is at least once and duplicate
event recovery checks the existing proof. These are source claims, not a live
Fabric verification performed by Graphify.

## Shipment authorization and quantities

[ShipmentsController](../apps/api/src/modules/shipments/shipments.controller.ts)
invokes [ShipmentsService](../apps/api/src/modules/shipments/shipments.service.ts).
Commands check roles, object ownership/assigned organization, version and state;
the current policy includes SYSTEM_ADMIN business commands.

Shipment transitions include CREATED -> IN_TRANSIT -> ARRIVED -> DELIVERED,
with REJECTED/FAILED branches. Receive, rejection and damage commands use Decimal
quantities and transactional writes, trace events and stock changes. A graph
edge alone cannot prove quantity correctness or concurrent transaction behavior.

## Public QR projection and hash verification

[Web public trace API](../apps/web/src/features/trace/api.ts) calls
`/public/trace/<traceToken>`. PublicTraceController in
[lots.controller](../apps/api/src/modules/lots/lots.controller.ts) delegates through
LotsService to [LotQueryService](../apps/api/src/modules/lots/lot-query.service.ts).
`getPublic` resolves TraceQr by token and selects the lot's own events plus
cycle-wide events with no lot ID; sibling harvest events are excluded.

[presentPublicLot](../apps/api/src/modules/lots/lot.presenter.ts) builds the public
projection with redacted actor details and no allowed commands.
[proofStatus and aggregateProofStatus](../apps/api/src/modules/lots/lot-proof-status.ts)
recompute local hashes and aggregate all relevant proof states. The latest
confirmed event does not make earlier pending or invalid events verified.
The Web mock API is an alternative development path and must not be used to
prove live backend behavior.

## PostgreSQL rules beyond the derived snapshot

`tools/graphify/input/schema-current.sql` is generated from Prisma without a
database connection. It represents Prisma-supported DDL only. Do not execute
it as a migration or assume it contains every database rule.

The committed migrations are additional implementation evidence:

- [Initial core](../apps/api/prisma/migrations/20260918120000_init_traceability_core/migration.sql)
  defines append-only trace events, immutable lot origin/shipment assignment,
  shipment insert checks, quantity constraints, telemetry/binding rules and
  proof-hash checks.
- [Command platform](../apps/api/prisma/migrations/20260921090000_command_platform_and_blockchain_outbox/migration.sql)
  adds harvest limits and production-cycle/shipment state transition triggers.
- [Farm type guard](../apps/api/prisma/migrations/20260921133000_farm_organization_type_guard/migration.sql)
  validates FARM organization ownership.
- [Restored invariants](../apps/api/prisma/migrations/20260921134000_restore_database_invariants/migration.sql)
  replaces the lot-derived-field function and validates the device/cycle binding
  for sensor readings.
- [Dedicated outbox](../apps/api/prisma/migrations/20260921140000_dedicated_blockchain_outbox/migration.sql)
  establishes outbox lease/completion constraints and preserves proof as receipt.

Migration SQL is not parsed into the main current-schema graph to avoid
coalescing earlier DDL with the derived current schema. Follow these references
and read the latest applicable definition when investigating a database rule.
Graphify has not inspected a running database or applied migrations.
