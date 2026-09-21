# ADR-001: Modular Monolith with a Dedicated Blockchain Worker

- Status: Accepted
- Date: 2026-09-21

## Context

Business commands must commit even when Hyperledger Fabric is slow or offline.
Running the relay timer inside every API replica couples HTTP availability to
Fabric credentials and makes process ownership unclear.

## Decision

The backend remains one modular NestJS codebase and one PostgreSQL database, but
is deployed as two independent processes built from the same image:

- API: owns HTTP, authentication, business commands and queries.
- Worker: owns blockchain delivery, Fabric signing credentials and retry state.

Every business command writes its domain changes, immutable `trace_event`, and
one `blockchain_outbox` row in the same PostgreSQL transaction. The worker claims
due rows with `FOR UPDATE SKIP LOCKED` and a lease token. A successful Fabric
commit creates `blockchain_proof` and completes the outbox row atomically.

`blockchain_proof` is a confirmed receipt. It is not a work queue. Temporary
delivery state belongs to `blockchain_outbox`.

## Module boundaries

- Identity and access: auth, users and organizations.
- Production: production cycles and lots.
- Logistics: shipments.
- Compliance: inspections and certificates.
- Telemetry: IoT readings and digests.
- Traceability: hash-chain creation and trace queries.
- Blockchain integration: proof queries in API; outbox relay in Worker.

Controllers call application services. Cross-module access uses exported public
providers or public entrypoints. The Worker composition root must not import HTTP
business modules, and the API composition root must not instantiate the worker
runner.

## Delivery guarantees

- Database changes and outbox creation are atomic.
- Delivery is at-least-once; Fabric event IDs make submission idempotent.
- Duplicate events are accepted only when their on-chain hash matches.
- A lease token prevents a stale worker from overwriting a newer claim.
- Transient errors use exponential backoff with jitter.
- Permanent errors and exhausted retries enter `DEAD_LETTER`.
- Hash-chain predecessors must be confirmed before their successor is claimed.

## Operational consequences

- API readiness depends on PostgreSQL, not Fabric.
- Only Worker receives the Fabric identity and TLS mounts.
- Worker exposes internal liveness/readiness endpoints but no public port.
- Stopping Worker grows the outbox backlog without rolling back business data.
- Kafka, Redis and independently deployed business microservices are intentionally
  out of scope until measured load requires them.

## Deployment order

1. Apply additive database migrations.
2. Start API and verify PostgreSQL readiness.
3. Start Worker and allow it to drain the outbox.
4. Start Web.

Rollback must stop Worker first. The outbox table and historical records are not
dropped during application rollback.
