BEGIN;

-- Operational observations are deliberately separate from immutable binding,
-- route, credential and ledger evidence. They grant no write authority.
CREATE TABLE binding_worker_health (
  binding_digest varchar(64) PRIMARY KEY
    REFERENCES fabric_network_binding(digest) ON DELETE RESTRICT ON UPDATE NO ACTION,
  last_checked_at timestamptz NOT NULL,
  last_healthy_at timestamptz,
  last_error_code varchar(60),
  certificate_expires_at timestamptz,
  CONSTRAINT ck_binding_worker_health_observation CHECK (
    last_healthy_at IS NULL OR last_healthy_at <= last_checked_at
  )
);

COMMIT;
