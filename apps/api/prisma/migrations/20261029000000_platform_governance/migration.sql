-- Platform governance (P0): append-only hash-chained audit log, optimistic
-- versions for platform status changes, account lockout/forced password change,
-- TOTP MFA and two-person (maker-checker) approvals.
-- Controlled migration: additive only. Existing rows, migrations, hashes and
-- history are untouched; old application code ignores the new columns/tables
-- (every new column is nullable or has a default).

ALTER TABLE app_user
  ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  ADD COLUMN locked_until timestamptz(6),
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at timestamptz(6);

ALTER TABLE organization
  ADD COLUMN version integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- platform_audit: append-only, gap-free sequence, prev_hash/entry_hash chain.
-- The application computes entry_hash (canonical JSON, SHA-256) inside the same
-- transaction as the audited write; the database guarantees the chain link and
-- forbids UPDATE/DELETE/TRUNCATE so that tampering is detectable and blocked.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_audit (
  platform_audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint NOT NULL,
  occurred_at timestamptz(3) NOT NULL,
  actor_user_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  actor_role varchar(50) NOT NULL,
  action varchar(80) NOT NULL,
  subject_type varchar(50) NOT NULL,
  subject_id varchar(64) NOT NULL,
  organization_id uuid REFERENCES organization(organization_id) ON DELETE RESTRICT,
  reason text,
  request_id varchar(100),
  idempotency_key varchar(255),
  outcome varchar(20) NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash char(64) NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash char(64) NOT NULL CHECK (entry_hash ~ '^[0-9a-f]{64}$'),
  CHECK (sequence >= 1),
  CHECK (actor_user_id IS NOT NULL OR actor_role = 'SYSTEM'),
  CONSTRAINT uq_platform_audit_sequence UNIQUE (sequence),
  CONSTRAINT uq_platform_audit_entry_hash UNIQUE (entry_hash)
);
CREATE INDEX ix_platform_audit_time ON platform_audit(occurred_at DESC, sequence DESC);
CREATE INDEX ix_platform_audit_actor ON platform_audit(actor_user_id, sequence DESC);
CREATE INDEX ix_platform_audit_action ON platform_audit(action, sequence DESC);
CREATE INDEX ix_platform_audit_subject ON platform_audit(subject_type, subject_id, sequence DESC);
CREATE INDEX ix_platform_audit_organization ON platform_audit(organization_id, sequence DESC) WHERE organization_id IS NOT NULL;

CREATE FUNCTION fn_platform_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_sequence bigint;
  last_hash char(64);
BEGIN
  -- Serialize appenders so the sequence stays gap-free and the chain linear.
  PERFORM pg_advisory_xact_lock(hashtextextended('platform_audit', 0));
  SELECT sequence, entry_hash INTO last_sequence, last_hash
    FROM platform_audit ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence IS DISTINCT FROM COALESCE(last_sequence, 0) + 1 THEN
    RAISE EXCEPTION 'platform_audit sequence must be %', COALESCE(last_sequence, 0) + 1
      USING ERRCODE = '23514';
  END IF;
  IF NEW.prev_hash IS DISTINCT FROM COALESCE(last_hash, repeat('0', 64)) THEN
    RAISE EXCEPTION 'platform_audit prev_hash does not match the chain head'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_platform_audit_chain BEFORE INSERT ON platform_audit
  FOR EACH ROW EXECUTE FUNCTION fn_platform_audit_chain();

CREATE FUNCTION fn_platform_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit is append-only' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER trg_platform_audit_no_update_delete BEFORE UPDATE OR DELETE ON platform_audit
  FOR EACH ROW EXECUTE FUNCTION fn_platform_audit_immutable();
CREATE TRIGGER trg_platform_audit_no_truncate BEFORE TRUNCATE ON platform_audit
  FOR EACH STATEMENT EXECUTE FUNCTION fn_platform_audit_immutable();

-- ---------------------------------------------------------------------------
-- platform_mfa: TOTP enrolment for SYSTEM_ADMIN. The secret is stored only as
-- AES-256-GCM ciphertext and recovery codes only as keyed hashes.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_mfa (
  user_id uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE RESTRICT,
  secret_ciphertext text NOT NULL,
  status varchar(10) NOT NULL CHECK (status IN ('PENDING', 'ENABLED')),
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_used_step bigint,
  enabled_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((status = 'ENABLED') = (enabled_at IS NOT NULL))
);
CREATE TRIGGER trg_platform_mfa_updated_at BEFORE UPDATE ON platform_mfa
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- platform_approval: maker-checker. The approver can never be the proposer
-- (enforced by the database), a decision is final and the proposal is
-- immutable after creation. An overdue proposal is marked EXPIRED by the system
-- so it stops blocking a new proposal for the same subject.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_approval (
  platform_approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation varchar(40) NOT NULL CHECK (operation IN (
    'CAPABILITY_GRANT', 'CREATE_CHAIN_GRANT', 'SYSTEM_ADMIN_CREATE',
    'CONNECTION_APPROVE', 'ADMIN_PASSWORD_RESET'
  )),
  subject_type varchar(50) NOT NULL,
  subject_id varchar(64) NOT NULL,
  organization_id uuid REFERENCES organization(organization_id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  proposer_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  proposer_reason text NOT NULL CHECK (length(btrim(proposer_reason)) >= 10),
  status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  expires_at timestamptz(6) NOT NULL,
  decided_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  decided_at timestamptz(6),
  decision_note text,
  result jsonb,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (decided_by IS NULL OR decided_by <> proposer_id OR status = 'CANCELLED'),
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  -- A person decides; the system only expires an overdue proposal.
  CHECK ((status IN ('PENDING', 'EXPIRED')) = (decided_by IS NULL)),
  CHECK (status IN ('PENDING', 'EXPIRED') OR length(btrim(COALESCE(decision_note, ''))) >= 10),
  CHECK (status <> 'APPROVED' OR result IS NOT NULL)
);
CREATE UNIQUE INDEX ux_platform_approval_pending_subject
  ON platform_approval(operation, subject_id) WHERE status = 'PENDING';
CREATE INDEX ix_platform_approval_status ON platform_approval(status, expires_at);
CREATE INDEX ix_platform_approval_proposer ON platform_approval(proposer_id, created_at DESC);

CREATE FUNCTION fn_platform_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'platform_approval cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'platform_approval decision is final' USING ERRCODE = '55000';
  END IF;
  IF NEW.platform_approval_id <> OLD.platform_approval_id OR NEW.operation <> OLD.operation
     OR NEW.subject_type <> OLD.subject_type OR NEW.subject_id <> OLD.subject_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.payload <> OLD.payload OR NEW.payload_hash <> OLD.payload_hash
     OR NEW.proposer_id <> OLD.proposer_id OR NEW.proposer_reason <> OLD.proposer_reason
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'platform_approval proposal is immutable' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_platform_approval_guard BEFORE UPDATE OR DELETE ON platform_approval
  FOR EACH ROW EXECUTE FUNCTION fn_platform_approval_guard();
