# Agri Trace Blockchain

Hyperledger Fabric foundation for the agricultural traceability platform. This branch implements the Blockchain work planned for weeks 1 and 2: the on-chain/off-chain model, TraceEvent proof contract, deterministic chaincode, duplicate protection, batch metadata, technical relayer identity, Gateway smoke client, and a reproducible local network workflow.

## Repository layout

- `blockchain/chaincode`: TypeScript Fabric smart contract and tests.
- `blockchain/gateway`: Fabric Gateway smoke client used by the Backend adapter.
- `blockchain/network`: wrappers around the official `fabric-samples/test-network`.
- `docs/architecture`: data boundary, schemas, adapter contract, and benchmark plan.

## Verify without Docker

```bash
cd blockchain/chaincode
npm ci
npm run check

cd ../gateway
npm ci
npm run check
```

## Run the local Fabric proof of concept

Prerequisites: Docker, Bash (Linux, macOS, WSL, or Git Bash), Node.js 18+, and curl.

```bash
cd blockchain/network
./network.sh bootstrap
./network.sh up
./network.sh enroll-relayer
./network.sh smoke
```

The `smoke` command deploys the chaincode, submits a `BATCH_CREATED` trace event with the separately enrolled relayer identity, then queries the event, proof, batch state, and batch history. Run `./network.sh down` when finished.

On Windows PowerShell, the equivalent entry point is:

```powershell
.\network.ps1 bootstrap
.\network.ps1 up
.\network.ps1 enroll-relayer
.\network.ps1 smoke
```

See [blockchain/network/README.md](blockchain/network/README.md) for configuration and troubleshooting.
