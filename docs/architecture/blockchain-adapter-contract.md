# BlockchainAdapter contract version 1

## Backend interface

```ts
interface BlockchainAdapter {
  submitTraceEvent(input: TraceEventInput): Promise<SubmitReceipt>;
  getProof(eventId: string): Promise<BlockchainProof>;
  getExpectedHash(eventId: string): Promise<string>;
  queryEvent(eventId: string): Promise<StoredTraceEvent>;
  queryBatchHistory(batchId: string): Promise<StoredTraceEvent[]>;
  getBatchState(batchId: string): Promise<BatchLedgerState>;
  healthCheck(): Promise<HealthResult>;
}
```

## Chaincode transactions

| Adapter method | Chaincode transaction | Submit/evaluate |
|---|---|---|
| `submitTraceEvent` | `RecordTraceEvent` | Submit |
| `getProof` | `GetProof` | Evaluate |
| `getExpectedHash` | `GetExpectedHash` | Evaluate |
| `queryEvent` | `QueryEvent` | Evaluate |
| `queryBatchHistory` | `QueryBatchHistory` | Evaluate |
| `getBatchState` | `GetBatchState` | Evaluate |
| `healthCheck` | `HealthCheck` | Evaluate |

## Receipt

`RecordTraceEvent` returns JSON containing `status`, `txId`, `eventId`, `batchId`, `dataHash`, `recordedAt`, `submitterMspId`, and `currentState`. Gateway commit failures and timeouts must remain distinct in the Backend. An unknown commit outcome must be reconciled by querying `eventId` before retrying.

## Errors

Chaincode errors begin with a stable code followed by a colon, for example `DUPLICATE_EVENT`, `DUPLICATE_BATCH`, `UNAUTHORIZED_RELAYER`, `INVALID_INPUT`, `UNSUPPORTED_EVENT_TYPE`, or `NOT_FOUND`. Backend maps these to its HTTP and idempotency conventions without matching localized prose.

## Identity

The Gateway client uses a dedicated X.509 identity registered with `app.role=relayer`. Business users never receive this key and never call Fabric directly. The Backend creates `actorContext` from authenticated server-side state; the browser must not supply authoritative role or organization values.
