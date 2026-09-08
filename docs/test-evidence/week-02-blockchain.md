# Blockchain week 2 test evidence

Verification date: 2026-09-09

## Local deterministic checks

| Check | Result |
|---|---|
| Chaincode TypeScript typecheck | Pass |
| Chaincode build | Pass |
| Chaincode tests | 28 passed |
| Chaincode statement coverage | 98.78% |
| Chaincode branch coverage | 96.87% |
| Gateway TypeScript typecheck | Pass |
| Gateway build | Pass |
| Gateway tests | 3 passed |
| Dependency audit, both packages | 0 vulnerabilities |
| Bash syntax | Pass |
| PowerShell syntax | Pass |
| Git whitespace check | Pass |

## Integration gate

The local Docker Desktop engine crashed before exposing its API, with its own backend reporting an invalid `dockerInference` listener path. No destructive Docker reset was performed. The repository CI therefore includes a clean Ubuntu `fabric-smoke` job that bootstraps Fabric 2.5.16, starts the CA-backed network, enrolls the relayer, deploys chaincode, submits `BATCH_CREATED`, queries event/proof/state/history, and shuts the network down.

The CI result after push is the authoritative Fabric network evidence for this revision.
