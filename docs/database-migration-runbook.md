# Legacy database migration runbook

1. Take a consistent backup and stop writes to the legacy database.
2. Create a clean PostgreSQL database and run `npm run db:migrate --workspace apps/api`.
3. Run `npm run db:seed --workspace apps/api` only for non-production environments.
4. Copy and adapt `apps/api/prisma/legacy-migration.sql` to the real legacy table names.
5. Migrate parent tables first, recording every key conversion in `migration_id_map`.
6. Rebuild operational events through the new command order; do not invent confirmed blockchain proofs.
7. Compare counts, ownership links, quantity balances, state transitions and RFC 8785 hashes.
8. Run the API integration/e2e suite against the migrated copy, then perform a read-only acceptance window.
9. Switch the application connection string only after acceptance; retain the old database read-only for rollback.

The SQL template deliberately ends in `ROLLBACK` so it cannot be executed as a production migration without an explicit review.
