# Local Hyperledger Fabric network

This directory provides a thin, pinned wrapper around Hyperledger's official `fabric-samples/test-network`. Generated binaries, Docker artifacts, certificates, and private keys are excluded from Git.

## Prerequisites

- Docker Engine or Docker Desktop is running.
- Bash, curl, Git, and Node.js 18 or later are available.
- Windows users run through Git Bash or a WSL distribution with Docker and Node.js integration. `network.ps1` prefers Git Bash when installed, then falls back to WSL Bash.

## Commands

```bash
cp .env.example .env
./network.sh bootstrap
./network.sh up
./network.sh enroll-relayer
./network.sh smoke
./network.sh down
```

`bootstrap` downloads Fabric 2.5.16, Fabric CA 1.5.22, matching samples, binaries, and Docker images. `up` creates a CA-backed two-organization network and the `agritrace` channel. `enroll-relayer` creates a distinct Org1 client certificate with `app.role=relayer`. `smoke` deploys the TypeScript contract and exercises record/query/proof/history/state through Fabric Gateway.

The bootstrap command forces `core.autocrlf=false` and `core.longpaths=true` for the downloaded samples so their Bash scripts remain LF-compatible and long Java sample paths can be checked out on Windows.

## Re-running

The relayer enrollment is idempotent while `identities/` is retained. A fresh `network.sh down` recreates the network CA database, so remove the ignored `identities/` directory manually before enrolling against a completely new network.

Increase `FABRIC_CHAINCODE_SEQUENCE` in `.env` whenever deploying an updated chaincode definition to an existing channel.

## Security boundary

The generated relayer key is for local testing only. Do not commit `identities/`, copy the key into frontend code, or use it as a business-user identity. Production key custody, CA policy, rotation, revocation, TLS, endorsement policy, and secret management require a separate deployment design.
