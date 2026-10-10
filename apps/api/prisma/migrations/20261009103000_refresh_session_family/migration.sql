ALTER TABLE refresh_session ADD COLUMN family_id uuid;

-- Keep this expansion nullable for the previous API on rollback. New code
-- treats a legacy NULL family_id as refresh_session_id; no backfill is needed.

CREATE INDEX ix_refresh_session_family_active
  ON refresh_session (family_id, revoked_at, expires_at);
