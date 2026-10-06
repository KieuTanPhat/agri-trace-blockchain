CREATE TABLE refresh_session (
  refresh_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz(6) NOT NULL,
  revoked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX ix_refresh_session_user_active
  ON refresh_session (user_id, revoked_at);
CREATE INDEX ix_refresh_session_expiry
  ON refresh_session (expires_at);
