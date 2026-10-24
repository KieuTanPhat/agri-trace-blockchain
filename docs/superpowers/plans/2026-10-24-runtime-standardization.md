# Runtime standardization implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; retain one writer and review the final diff against the source SHA.

**Goal:** Standardize Node.js 24.22.1, npm 12.1.0 and PostgreSQL 18, preserve the existing lint policy, and deliver a draft PR based on PR #122.

**Architecture:** `.node-version` declares the Node release for local tools and GitHub Actions. Workspace engines and immutable Docker images agree with that release. Local Compose uses the PostgreSQL 18 image already exercised by API, Hybrid and production rehearsal.

**Tech Stack:** Next.js, NestJS, npm workspaces, PostgreSQL, Docker, ESLint/Oxlint, Hyperledger Fabric.

**Spec:** The owner approved these choices on 2026-10-24: Node 24.22.1 and npm 12.1.0 as Windows defaults; discard only `agri-trace-demo-local_postgres-data` without backup; migrate and seed the new local database; upgrade ESLint/plugins; update production configuration without VPS access; commit, push and open a draft PR, without merging.

## Global constraints

- Start from PR #122 head `ae8faff923bc52e379227a369f563f7b9150fcbd` on `chore/node24-postgres18-standardization`.
- Keep production data, VPS, historical migrations and unrelated worktrees untouched.
- Pass secret files directly to their consumers; keep credentials and operational evidence outside Git.
- Preserve all 71 TypeScript / 67 JavaScript lint rules, their levels/options and meaningful fixture coverage. Do not force incompatible peers or suppress findings to upgrade ESLint.
- Preserve the independent chaincode lockfile and its isolated verification.

## Review focus

- Node/npm parity across Windows defaults, workspace engines, CI and all Docker stages.
- PostgreSQL 18 mount path, TCP readiness and image parity across local and CI.
- Lint rule parity and valid peer graphs after upgrading ESLint.
- Only the approved local database volume is discarded; fresh migrations precede seeding.
- Native dependencies, production images and Worker/chaincode remain executable on Node 24.

### Task 1: Runtime and dependency configuration

- [x] Add `.node-version` and enforce compatible Node/npm engines in root and workspace manifests.
- [x] Use the version file in CI; remove the Node 22/26 matrix.
- [x] Pin all Node base images to the approved 24.22.1 image digest.
- [x] Align local PostgreSQL image, mount and readiness with the PostgreSQL 18 baseline.
- [x] Update maintained setup/CI/frontend documentation and both lockfiles.

### Task 2: ESLint migration

The owner also approved an MIT-preserving local adapter for `react/no-deprecated`, the one original rule absent from native Oxlint. Capture its original diagnostics before removing the old plugin, and keep differential fixture coverage.

- [x] Resolve stable plugin support for ESLint 10; use compatible maintained engines for legacy plugin rules if necessary.
- [x] Retain policy severities, options, JavaScript/TypeScript distinction and fixtures.
- [x] Verify clean installs, dependency graphs, full/production audits, lint contract and Web checks.

### Task 3: Windows defaults

- [x] Verify the official Node 24.22.1 installer checksum and signature.
- [x] Install Node and npm 12.1.0 as machine defaults; verify a fresh shell resolves both versions.

### Task 4: Local database and application

- [x] Verify Compose ownership and the exact volume before stopping its local services.
- [x] Remove only the approved PostgreSQL container/volume and create PostgreSQL 18 with the proper mount.
- [x] Apply unchanged historical migrations to the empty database.
- [x] Seed current demonstration data and verify login, database consistency and service health (Fabric-disabled readiness remains explicit).

### Task 5: Final delivery acceptance

Record delivery status and exact-SHA CI results in the PR, rather than updating
this implementation plan with per-run evidence.

- Run relevant CI/policy, lint, type, unit, database and production image checks; record real environment limitations.
- Review the complete incremental diff against the source SHA and fix evidenced findings.
- Commit, push, create and attach a draft PR; inspect its CI results.
