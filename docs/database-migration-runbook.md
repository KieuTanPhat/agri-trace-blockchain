# Database migration and restoration

Fresh production follows [the current runbook](production-runbook.md). The old
test database/ledger is archived, not imported into the new business model.

1. Stop writers and capture an encrypted, consistent database/ledger/identity/config backup.
2. Download outside VPS, decrypt/check checksums and restore to isolated owned resources.
3. Compare migration bytes/checksums, counts, hashes, transaction IDs and ledger validation.
4. Provision a separate empty database; apply immutable historical migrations and append-only cleanup.
5. Cleanup refuses existing business history/exemptions. Never rewrite applied migrations or reset a shared DB.
6. Bootstrap production through the private operator, then run real VPS smoke. UAT seed remains forbidden in production.
7. Preserve the Hybrid floor and original command keys on failure; recover the exact candidate.

Database restoration is separate from application rollback. Do not restore only PostgreSQL after ledger commits. Per-run restoration evidence stays private in PR/Issue/local artifacts.
