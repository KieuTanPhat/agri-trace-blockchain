# Fabric and Polygon benchmark plan

## Decision

Hyperledger Fabric is the core ledger for the proof of concept. Polygon is an optional comparison spike and must not block Fabric delivery.

## Shared workload

Use the same canonical `TraceEventInput` corpus and query mix for both systems:

- 60% `RecordTraceEvent`
- 20% `QueryEvent` or proof query
- 20% `QueryBatchHistory`
- Payload metadata sizes: 0.5 KiB, 2 KiB, and 8 KiB
- Concurrency: 1, 5, 10, 25, and 50 clients
- Run length: 5-minute warm-up, 15-minute measurement, three repetitions

Measure submitted, committed, rejected, and unknown outcomes separately. Report p50/p95/p99 end-to-end latency, committed transactions per second, error rate, infrastructure allocation, and estimated transaction cost.

## Fabric profile

- Fabric 2.5 LTS, two peer organizations, Raft orderer, LevelDB baseline.
- Endorsement policy: both organizations for the comparison run.
- Fabric Gateway submission with commit-status confirmation.
- Caliper harness is added in the later performance sprint; week 1 only locks the workload and metrics.

## Polygon spike

Map only `eventId`, `batchId`, `eventType`, `dataHash`, and actor/proof digests to a Solidity interface. Run on a test network and record gas, confirmation latency, reorg/finality assumptions, and public-data exposure. Do not put raw sensor or private actor data in calldata or contract storage.

## Comparability limits

Fabric and Polygon have different trust, privacy, finality, and cost models. Results are engineering observations under a declared environment, not a claim that one ledger is universally faster or more secure.
