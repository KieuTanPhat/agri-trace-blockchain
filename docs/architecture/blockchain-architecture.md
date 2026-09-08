# Blockchain architecture weeks 1 and 2

## Purpose

The Fabric layer proves that an authenticated Backend relayer submitted a specific trace-event digest and records the minimum state needed to reject duplicates and support ordered history queries. It does not replace Backend business authorization and it never receives raw sensor readings or private payloads.

## Components

1. The PWA or IoT client sends a business command to the NestJS Backend.
2. The Backend authenticates the business actor, checks role, organization ownership, state, and idempotency.
3. The Backend canonicalizes the approved off-chain payload with RFC 8785 and computes SHA-256.
4. The BlockchainAdapter submits a `TraceEventInput` through a dedicated Fabric relayer identity.
5. Chaincode verifies the relayer certificate attribute, validates the envelope, rejects duplicate event/batch identifiers, and writes the event, proof, batch metadata, and history index atomically.
6. The Gateway returns the transaction result. The Backend records the receipt in `BlockchainProof` off-chain.

## Trust boundary

- Business actor identity is represented by `actorContext` and bound to `actorAuthProof` produced by the Backend.
- Fabric submitter identity is independently captured from `ctx.clientIdentity`; it must have the certificate attribute `app.role=relayer`.
- The chaincode validates the evidence shape and actor/proof binding. It does not accept a browser wallet or infer business permissions from the Fabric identity.
- Production must protect the relayer private key with an appropriate secret store or HSM. The local proof of concept writes generated material only under an ignored directory.

## Ledger keys

| Object | Composite key | Purpose |
|---|---|---|
| Trace event | `traceEvent~eventId` | Immutable event digest and audit metadata |
| Blockchain proof | `traceProof~eventId` | Expected digest and Fabric transaction metadata |
| Batch state | `traceBatch~batchId` | Current lifecycle metadata and last event |
| History index | `batchEvent~batchId~recordedAt~txId~eventId` | Deterministic ordered lookup |

Week 1-2 supports the `BATCH_CREATED` transition only. Later event types must be added with explicit state and actor rules; unsupported types are rejected instead of silently trusting client-provided state.

## Determinism and consistency

- Ledger JSON is serialized with RFC 8785 canonicalization.
- Transaction time comes from the Fabric proposal timestamp, not the peer wall clock.
- State and history keys are written in one transaction.
- Duplicate `eventId` and duplicate initial `batchId` are rejected before writes.
- Queries return stable key order and never mutate state.

## Version baseline

- Hyperledger Fabric 2.5.16 LTS
- Hyperledger Fabric CA 1.5.22
- Fabric Contract API and shim 2.5.8
- Fabric Gateway client 1.12.1
