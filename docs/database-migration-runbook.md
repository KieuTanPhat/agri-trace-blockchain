# Database migration and restoration

Fresh production follows [the current runbook](production-runbook.md). The old
test database/ledger is archived, not imported into the new business model.

1. Stop writers and capture an encrypted, consistent database/ledger/identity/config backup.
2. Download outside VPS, decrypt/check checksums and restore to isolated owned resources.
3. Compare migration bytes/checksums, counts, hashes, transaction IDs and ledger validation.
4. Provision a separate empty database; apply immutable historical migrations and append-only cleanup.
5. Cleanup refuses existing business history/exemptions. Never rewrite applied migrations or reset a shared DB.
6. Bootstrap production through the private operator, then run real VPS smoke. Production never receives fixture accounts or default credentials.
7. Preserve the Hybrid floor and original command keys on failure; recover the exact candidate.

Database restoration is separate from application rollback. Do not restore only PostgreSQL after ledger commits. Per-run restoration evidence stays private in PR/Issue/local artifacts.

## Local runtime baseline

Local Compose and CI use PostgreSQL 18 with the same pinned image digest. The
volume is mounted at `/var/lib/postgresql`; the image manages its major-specific
PGDATA below that directory. Readiness checks use TCP so initdb's temporary
Unix-socket server cannot release API migration early.

An existing PostgreSQL 16 data directory cannot be reused directly by PostgreSQL
18. Preserve important data with a reviewed major-version upgrade. For disposable
local data, explicit owner authorization may instead allow removing only the
identified local volume, creating a fresh 18 cluster and applying migrations.
Seed checkpoints from the discarded database must not be replayed into the fresh
database. The standard `seed-current.ps1` replacement path keeps its backup guards;
an explicitly authorized fresh-cluster initialization must verify the local
project, empty application tables, completed migrations and disabled Fabric first.
After that initialization, `node scripts/demo/verify-seed.mjs --fresh` verifies
the dataset and records `backup: null` with the explicit no-backup limitation.
The default verifier still requires the replacement workflow's backup receipt.

Production database changes require separate runtime verification and the existing
release/backup/ledger safeguards. Local reset authorization does not apply to VPS.
