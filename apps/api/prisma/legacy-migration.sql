-- Legacy -> v2 migration template. Run only after the new schema migrations.
-- Replace legacy_* names with the actual old schema/table names and test in a copy.
BEGIN;

-- Preserve legacy identifiers in a staging map so foreign keys can be rebuilt
-- deterministically. Each insert is idempotent and can be resumed.
CREATE TABLE IF NOT EXISTS migration_id_map (
  entity_type text NOT NULL,
  legacy_id text NOT NULL,
  new_id uuid NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, legacy_id),
  UNIQUE (entity_type, new_id)
);

-- Example order (parents before children):
-- organization -> app_role -> app_user -> product -> farm -> plot
-- -> production_cycle -> care/sensor/harvest -> lot -> shipment -> trace_event.
-- Use INSERT ... ON CONFLICT DO NOTHING and populate migration_id_map with
-- RETURNING IDs for every table whose legacy key is not already a UUID.

-- Validation gates before COMMIT:
-- 1. Compare source/target row counts by entity.
-- 2. Verify no orphan foreign keys.
-- 3. Recompute lot quantities from quantity_movement.
-- 4. Recompute every trace_event.data_hash using RFC 8785.
-- 5. Keep blockchain proofs PENDING; never copy an unverified txId.

-- COMMIT only after the validation report is clean.
ROLLBACK;
