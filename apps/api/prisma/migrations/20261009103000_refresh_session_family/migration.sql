ALTER TABLE refresh_session ADD COLUMN family_id uuid;

-- Existing sessions remain refreshable; the next rotation issues a JWT bound
-- to their original session ID. Already-issued JWTs without sid fail closed.
UPDATE refresh_session SET family_id = refresh_session_id;

ALTER TABLE refresh_session ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX ix_refresh_session_family_active
  ON refresh_session (family_id, revoked_at, expires_at);
