-- Controlled migration: immutable audit trigger requires the reviewed migration
-- gate. Do not relax deploy/cd/policy.py or edit previously applied migrations.
ALTER TABLE idempotency_record ADD COLUMN authorization_scope VARCHAR(64);

CREATE TABLE command_commit (
  command_commit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_record_id UUID NOT NULL UNIQUE REFERENCES idempotency_record(idempotency_record_id),
  requester_id VARCHAR(255) NOT NULL,
  operation VARCHAR(100) NOT NULL,
  authorization_scope VARCHAR(64) NOT NULL,
  actor_scope JSONB NOT NULL,
  resource_ids JSONB NOT NULL,
  response_status INTEGER NOT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_body JSONB NOT NULL,
  committed_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX ix_command_commit_requester_time ON command_commit(requester_id, committed_at);

CREATE FUNCTION protect_command_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER trg_command_commit_immutable BEFORE UPDATE OR DELETE ON command_commit
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
