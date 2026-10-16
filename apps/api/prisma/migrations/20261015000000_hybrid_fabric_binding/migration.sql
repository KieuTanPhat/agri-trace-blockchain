-- Hybrid release B: per-chain ledger binding, permission epochs synchronized
-- with the ledger, delivery attempts and holds.
--
-- Additive on top of release A. Existing chains/cycles/events keep their
-- release-A route (envelope 3.0.0, hash 2.0.0): a cycle is a B stream only when
-- it has a cycle_ledger_context row, written at genesis and never changed.
BEGIN;

CREATE TYPE ledger_profile AS ENUM ('SERVICE', 'MANAGED_ORG', 'SELF_MANAGED_ORG');
CREATE TYPE fabric_binding_status AS ENUM ('PENDING', 'ACTIVE', 'PAUSED');
CREATE TYPE ledger_permission_state AS ENUM (
  'REQUESTED', 'PENDING_LEDGER', 'ACTIVE',
  'REVOKE_REQUESTED', 'DRAINING', 'PENDING_REVOKE_LEDGER', 'REVOKED',
  'EMERGENCY_HOLD', 'PENDING_EMERGENCY_REVOKE', 'REVOKED_REVIEW_REQUIRED');
CREATE TYPE ledger_control_operation AS ENUM ('PERMISSION_GRANT', 'PERMISSION_REVOKE', 'PERMISSION_EMERGENCY_REVOKE', 'FENCE_DELIVERY');
CREATE TYPE ledger_control_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE delivery_state AS ENUM ('PREPARED', 'ENDORSED', 'SUBMITTED', 'VALID', 'INVALID', 'UNKNOWN', 'ABANDONED');
CREATE TYPE delivery_hold_scope AS ENUM ('BINDING', 'PERMISSION', 'EVENT');

-------------------------------------------------------------------------------
-- Profile and binding
-------------------------------------------------------------------------------
-- chain_ref is the opaque, stable ledger identifier of a chain (never the DB id).
CREATE TABLE chain_ledger_profile (
  chain_id uuid PRIMARY KEY REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  chain_ref uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  active_binding_digest varchar(64),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_chain_ledger_profile_ref UNIQUE (chain_id, chain_ref)
);

CREATE TABLE fabric_network_binding (
  digest varchar(64) PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  chain_id uuid NOT NULL,
  chain_ref uuid NOT NULL,
  network varchar(100) NOT NULL CHECK (network ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  channel_id varchar(100) NOT NULL CHECK (channel_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  chaincode_name varchar(100) NOT NULL CHECK (chaincode_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  contract_name varchar(100) NOT NULL CHECK (contract_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  envelope_version varchar(10) NOT NULL CHECK (envelope_version = '4.0.0'),
  writer_authority varchar(100) NOT NULL CHECK (writer_authority ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  writer_msp_id varchar(100) NOT NULL CHECK (writer_msp_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  writer_role varchar(50) NOT NULL CHECK (writer_role = 'relayer'),
  governance_digest varchar(64) NOT NULL CHECK (governance_digest ~ '^[a-f0-9]{64}$'),
  profile ledger_profile NOT NULL,
  route_digest varchar(64) NOT NULL REFERENCES ledger_route_definition (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_fabric_binding_chain UNIQUE (digest, chain_id),
  FOREIGN KEY (chain_id, chain_ref) REFERENCES chain_ledger_profile (chain_id, chain_ref) ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE INDEX ix_fabric_binding_chain ON fabric_network_binding (chain_id);

ALTER TABLE chain_ledger_profile ADD CONSTRAINT fk_profile_active_binding
  FOREIGN KEY (active_binding_digest, chain_id) REFERENCES fabric_network_binding (digest, chain_id)
  ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ledger_route_definition ADD CONSTRAINT fk_route_binding
  FOREIGN KEY (binding_digest) REFERENCES fabric_network_binding (digest)
  ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE fabric_binding_state (
  binding_digest varchar(64) PRIMARY KEY REFERENCES fabric_network_binding (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  status fabric_binding_status NOT NULL DEFAULT 'PENDING',
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

-- Worker credential allowlist mirrored from the ledger registry. The private
-- key never appears here: only the certificate fingerprint.
CREATE TABLE fabric_credential_revision (
  credential_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_digest varchar(64) NOT NULL REFERENCES fabric_network_binding (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  cert_fingerprint varchar(64) NOT NULL CHECK (cert_fingerprint ~ '^[a-f0-9]{64}$'),
  status varchar(10) NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED', 'REVOKED')),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6),
  CONSTRAINT uq_fabric_credential UNIQUE (binding_digest, cert_fingerprint),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-------------------------------------------------------------------------------
-- Stream origin and event context
-------------------------------------------------------------------------------
CREATE TABLE cycle_ledger_context (
  cycle_id uuid PRIMARY KEY,
  chain_id uuid NOT NULL,
  binding_digest varchar(64) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, chain_id) REFERENCES production_cycle (cycle_id, chain_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (binding_digest, chain_id) REFERENCES fabric_network_binding (digest, chain_id) ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE event_binding_context (
  event_id uuid PRIMARY KEY REFERENCES trace_event (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  binding_digest varchar(64) NOT NULL REFERENCES fabric_network_binding (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  private_body_digest varchar(64) NOT NULL CHECK (private_body_digest ~ '^[a-f0-9]{64}$'),
  commitment_version varchar(10) NOT NULL DEFAULT 'b1' CHECK (commitment_version = 'b1'),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

-------------------------------------------------------------------------------
-- Permissions: DB grants synchronized with ledger epochs
-------------------------------------------------------------------------------
CREATE TABLE ledger_permission (
  permission_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_digest varchar(64) NOT NULL REFERENCES fabric_network_binding (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  role "ScopedRole" NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, organization_id) REFERENCES app_user (user_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT uq_ledger_permission_subject UNIQUE (binding_digest, user_id, role)
);

CREATE TABLE ledger_permission_epoch (
  permission_ref uuid NOT NULL REFERENCES ledger_permission ON UPDATE NO ACTION ON DELETE RESTRICT,
  epoch integer NOT NULL CHECK (epoch >= 1),
  grant_id uuid NOT NULL UNIQUE REFERENCES scoped_role_grant ON UPDATE NO ACTION ON DELETE RESTRICT,
  entity_types text[] NOT NULL CHECK (cardinality(entity_types) BETWEEN 1 AND 10),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (permission_ref, epoch)
);

CREATE TABLE ledger_permission_sync (
  permission_ref uuid PRIMARY KEY REFERENCES ledger_permission ON UPDATE NO ACTION ON DELETE RESTRICT,
  requested_epoch integer NOT NULL CHECK (requested_epoch >= 1),
  confirmed_epoch integer CHECK (confirmed_epoch >= 1),
  state ledger_permission_state NOT NULL DEFAULT 'REQUESTED',
  next_ordinal bigint NOT NULL DEFAULT 1 CHECK (next_ordinal >= 1),
  barrier_ordinal bigint CHECK (barrier_ordinal >= 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_tx_id varchar(64),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (permission_ref, requested_epoch) REFERENCES ledger_permission_epoch (permission_ref, epoch) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CHECK (confirmed_epoch IS NULL OR confirmed_epoch <= requested_epoch)
);
CREATE INDEX ix_ledger_permission_sync_state ON ledger_permission_sync (state);

CREATE TABLE event_permission_epoch (
  event_id uuid NOT NULL REFERENCES event_binding_context (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  permission_ref uuid NOT NULL,
  epoch integer NOT NULL,
  ordinal bigint NOT NULL CHECK (ordinal >= 1),
  PRIMARY KEY (event_id, permission_ref),
  FOREIGN KEY (permission_ref, epoch) REFERENCES ledger_permission_epoch (permission_ref, epoch) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT uq_event_permission_ordinal UNIQUE (permission_ref, ordinal)
);

CREATE TABLE ledger_control_job (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_digest varchar(64) NOT NULL REFERENCES fabric_network_binding (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  operation ledger_control_operation NOT NULL,
  -- Permission operations name a permission epoch; a delivery fence names the event.
  permission_ref uuid REFERENCES ledger_permission ON UPDATE NO ACTION ON DELETE RESTRICT,
  epoch integer CHECK (epoch >= 1),
  event_id uuid REFERENCES trace_event (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  -- Stable proposal nonce: retries after an unknown outcome converge on the
  -- same ledger proposal instead of creating a new one.
  nonce uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status ledger_control_status NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(6) DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz(6),
  proposal_id varchar(64),
  receipt jsonb,
  last_error text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (permission_ref, epoch) REFERENCES ledger_permission_epoch (permission_ref, epoch) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CHECK (
    (operation = 'FENCE_DELIVERY' AND event_id IS NOT NULL AND permission_ref IS NULL AND epoch IS NULL) OR
    (operation <> 'FENCE_DELIVERY' AND event_id IS NULL AND permission_ref IS NOT NULL AND epoch IS NOT NULL))
);
CREATE INDEX ix_ledger_control_job_due ON ledger_control_job (status, next_attempt_at);

-------------------------------------------------------------------------------
-- Delivery audit and holds
-------------------------------------------------------------------------------
CREATE TABLE delivery_attempt (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES blockchain_outbox (outbox_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  binding_digest varchar(64) NOT NULL REFERENCES fabric_network_binding (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  lease_token uuid NOT NULL,
  credential_fingerprint varchar(64) NOT NULL CHECK (credential_fingerprint ~ '^[a-f0-9]{64}$'),
  tx_id varchar(64) NOT NULL,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_delivery_attempt_tx UNIQUE (binding_digest, tx_id)
);
CREATE INDEX ix_delivery_attempt_outbox ON delivery_attempt (outbox_id, created_at);

CREATE TABLE delivery_attempt_outcome (
  attempt_id uuid NOT NULL REFERENCES delivery_attempt ON UPDATE NO ACTION ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence >= 1),
  state delivery_state NOT NULL,
  detail text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, sequence)
);

CREATE TABLE delivery_hold (
  hold_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_digest varchar(64) NOT NULL REFERENCES fabric_network_binding (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  scope delivery_hold_scope NOT NULL,
  permission_ref uuid REFERENCES ledger_permission ON UPDATE NO ACTION ON DELETE RESTRICT,
  event_id uuid REFERENCES trace_event (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  opened_at timestamptz(6) NOT NULL DEFAULT now(),
  resolved_at timestamptz(6),
  resolution text,
  CHECK (
    (scope = 'BINDING' AND permission_ref IS NULL AND event_id IS NULL) OR
    (scope = 'PERMISSION' AND permission_ref IS NOT NULL AND event_id IS NULL) OR
    (scope = 'EVENT' AND event_id IS NOT NULL AND permission_ref IS NULL)),
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
CREATE INDEX ix_delivery_hold_open ON delivery_hold (binding_digest) WHERE resolved_at IS NULL;

-------------------------------------------------------------------------------
-- Guards
-------------------------------------------------------------------------------
CREATE TRIGGER trg_fabric_binding_immutable BEFORE UPDATE OR DELETE ON fabric_network_binding
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_cycle_ledger_context_immutable BEFORE UPDATE OR DELETE ON cycle_ledger_context
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_event_binding_context_immutable BEFORE UPDATE OR DELETE ON event_binding_context
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_ledger_permission_immutable BEFORE UPDATE OR DELETE ON ledger_permission
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_ledger_permission_epoch_immutable BEFORE UPDATE OR DELETE ON ledger_permission_epoch
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_event_permission_epoch_immutable BEFORE UPDATE OR DELETE ON event_permission_epoch
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_delivery_attempt_immutable BEFORE UPDATE OR DELETE ON delivery_attempt
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_delivery_outcome_immutable BEFORE UPDATE OR DELETE ON delivery_attempt_outcome
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

CREATE FUNCTION fn_b_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st fabric_binding_status;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Ledger profile history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 0 OR NEW.active_binding_digest IS NOT NULL THEN RAISE EXCEPTION 'Profile starts without an active binding'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.chain_id, NEW.chain_ref, NEW.created_at) IS DISTINCT FROM ROW(OLD.chain_id, OLD.chain_ref, OLD.created_at)
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Ledger profile identity is immutable and changes need a version';
  END IF;
  IF NEW.active_binding_digest IS NOT NULL THEN
    SELECT status INTO st FROM fabric_binding_state WHERE binding_digest = NEW.active_binding_digest;
    IF st IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Only an ACTIVE binding can become the chain profile'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chain_ledger_profile_guard BEFORE INSERT OR UPDATE OR DELETE ON chain_ledger_profile
  FOR EACH ROW EXECUTE FUNCTION fn_b_profile_guard();

CREATE FUNCTION fn_b_binding_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Binding state history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.version <> 0 THEN RAISE EXCEPTION 'A binding starts PENDING'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.binding_digest <> OLD.binding_digest OR NEW.version <> OLD.version + 1
    OR NOT ((OLD.status = 'PENDING' AND NEW.status = 'ACTIVE')
      OR (OLD.status = 'ACTIVE' AND NEW.status = 'PAUSED')
      OR (OLD.status = 'PAUSED' AND NEW.status = 'ACTIVE')) THEN
    RAISE EXCEPTION 'Invalid binding state transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_fabric_binding_state_guard BEFORE INSERT OR UPDATE OR DELETE ON fabric_binding_state
  FOR EACH ROW EXECUTE FUNCTION fn_b_binding_state_guard();

CREATE FUNCTION fn_b_credential_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Credential history cannot be deleted'; END IF;
  IF OLD.status <> 'APPROVED' OR NEW.status <> 'REVOKED'
    OR ROW(NEW.credential_id, NEW.binding_digest, NEW.cert_fingerprint, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.credential_id, OLD.binding_digest, OLD.cert_fingerprint, OLD.created_at) THEN
    RAISE EXCEPTION 'A credential can only move from APPROVED to REVOKED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_fabric_credential_guard BEFORE UPDATE OR DELETE ON fabric_credential_revision
  FOR EACH ROW EXECUTE FUNCTION fn_b_credential_guard();

-- A B stream starts only on the chain's currently ACTIVE binding.
CREATE FUNCTION fn_b_cycle_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_digest varchar(64); st fabric_binding_status;
BEGIN
  SELECT active_binding_digest INTO active_digest FROM chain_ledger_profile WHERE chain_id = NEW.chain_id;
  IF active_digest IS DISTINCT FROM NEW.binding_digest THEN
    RAISE EXCEPTION 'Cycle genesis must use the chain active binding';
  END IF;
  SELECT status INTO st FROM fabric_binding_state WHERE binding_digest = NEW.binding_digest;
  IF st IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Binding is not ACTIVE'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_cycle_ledger_context_scope BEFORE INSERT ON cycle_ledger_context
  FOR EACH ROW EXECUTE FUNCTION fn_b_cycle_context();

-- An event is a B event only through its immutable cycle origin and route.
CREATE FUNCTION fn_b_event_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle_binding varchar(64); event_cycle uuid;
BEGIN
  SELECT coalesce(e.cycle_id, h.cycle_id) INTO event_cycle FROM trace_event e
    LEFT JOIN lot l ON l.lot_id = e.lot_id LEFT JOIN harvest_event h ON h.harvest_id = l.harvest_id
    WHERE e.event_id = NEW.event_id;
  SELECT binding_digest INTO cycle_binding FROM cycle_ledger_context WHERE cycle_id = event_cycle;
  IF cycle_binding IS DISTINCT FROM NEW.binding_digest THEN
    RAISE EXCEPTION 'Event binding differs from its cycle origin binding';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_event_binding_context_scope BEFORE INSERT ON event_binding_context
  FOR EACH ROW EXECUTE FUNCTION fn_b_event_context();

CREATE FUNCTION fn_b_event_context_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; route_binding varchar(64);
BEGIN
  SELECT count(*) INTO n FROM event_permission_epoch WHERE event_id = NEW.event_id;
  IF n < 1 OR n > 16 THEN RAISE EXCEPTION 'B event needs 1-16 captured permission epochs'; END IF;
  SELECT d.binding_digest INTO route_binding FROM event_ledger_route r
    JOIN ledger_route_definition d ON d.digest = r.definition_digest WHERE r.event_id = NEW.event_id;
  IF route_binding IS DISTINCT FROM NEW.binding_digest THEN
    RAISE EXCEPTION 'B event route must be the binding route';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_event_binding_context_complete AFTER INSERT ON event_binding_context
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_b_event_context_complete();

-- A grant not confirmed on the ledger opens no write: the captured epoch must
-- be the current, confirmed and ACTIVE epoch, and the ordinal is the one just
-- reserved on the permission lock.
CREATE FUNCTION fn_b_event_permission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s ledger_permission_sync%ROWTYPE; ctx_binding varchar(64); perm_binding varchar(64);
BEGIN
  SELECT binding_digest INTO ctx_binding FROM event_binding_context WHERE event_id = NEW.event_id;
  SELECT binding_digest INTO perm_binding FROM ledger_permission WHERE permission_ref = NEW.permission_ref;
  IF ctx_binding IS DISTINCT FROM perm_binding THEN RAISE EXCEPTION 'Permission belongs to another binding'; END IF;
  SELECT * INTO STRICT s FROM ledger_permission_sync WHERE permission_ref = NEW.permission_ref FOR SHARE;
  IF s.state <> 'ACTIVE' OR s.confirmed_epoch IS DISTINCT FROM NEW.epoch OR s.requested_epoch <> NEW.epoch THEN
    RAISE EXCEPTION 'Permission is not confirmed ACTIVE on the ledger at this epoch';
  END IF;
  IF NEW.ordinal <> s.next_ordinal - 1 THEN RAISE EXCEPTION 'Permission ordinal was not reserved under the permission lock'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_event_permission_epoch_scope BEFORE INSERT ON event_permission_epoch
  FOR EACH ROW EXECUTE FUNCTION fn_b_event_permission();

CREATE FUNCTION fn_b_permission_sync_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Permission sync history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'REQUESTED' OR NEW.requested_epoch <> 1 OR NEW.version <> 0
      OR NEW.confirmed_epoch IS NOT NULL OR NEW.next_ordinal <> 1 THEN
      RAISE EXCEPTION 'Permission sync starts REQUESTED at epoch 1';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.permission_ref <> OLD.permission_ref OR NEW.version <> OLD.version + 1
    OR NEW.next_ordinal < OLD.next_ordinal OR NEW.requested_epoch < OLD.requested_epoch
    OR (NEW.confirmed_epoch IS NOT NULL AND OLD.confirmed_epoch IS NOT NULL AND NEW.confirmed_epoch < OLD.confirmed_epoch) THEN
    RAISE EXCEPTION 'Invalid permission sync update';
  END IF;
  IF NEW.state = OLD.state THEN
    -- Same-state updates: ordinal reservation, receipt recording, barrier hold.
    IF NEW.requested_epoch <> OLD.requested_epoch THEN RAISE EXCEPTION 'Epoch changes require a state transition'; END IF;
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.state = 'REQUESTED' AND NEW.state IN ('PENDING_LEDGER', 'REVOKED'))
    OR (OLD.state = 'PENDING_LEDGER' AND NEW.state IN ('ACTIVE', 'REVOKE_REQUESTED', 'EMERGENCY_HOLD'))
    OR (OLD.state = 'ACTIVE' AND NEW.state IN ('REVOKE_REQUESTED', 'EMERGENCY_HOLD'))
    OR (OLD.state = 'REVOKE_REQUESTED' AND NEW.state IN ('DRAINING', 'EMERGENCY_HOLD'))
    OR (OLD.state = 'DRAINING' AND NEW.state IN ('PENDING_REVOKE_LEDGER', 'EMERGENCY_HOLD'))
    OR (OLD.state = 'PENDING_REVOKE_LEDGER' AND NEW.state IN ('REVOKED', 'EMERGENCY_HOLD'))
    OR (OLD.state = 'EMERGENCY_HOLD' AND NEW.state = 'PENDING_EMERGENCY_REVOKE')
    OR (OLD.state = 'PENDING_EMERGENCY_REVOKE' AND NEW.state = 'REVOKED_REVIEW_REQUIRED')
    OR (OLD.state IN ('REVOKED', 'REVOKED_REVIEW_REQUIRED') AND NEW.state = 'REQUESTED')
  ) THEN
    RAISE EXCEPTION 'Invalid permission sync transition % -> %', OLD.state, NEW.state;
  END IF;
  IF NEW.state = 'REQUESTED' AND NEW.requested_epoch <> OLD.requested_epoch + 1 THEN
    RAISE EXCEPTION 'Regrant needs the next epoch';
  END IF;
  IF NEW.state <> 'REQUESTED' AND NEW.requested_epoch <> OLD.requested_epoch THEN
    RAISE EXCEPTION 'Only a regrant changes the requested epoch';
  END IF;
  IF NEW.state = 'ACTIVE' AND NEW.confirmed_epoch IS DISTINCT FROM NEW.requested_epoch THEN
    RAISE EXCEPTION 'ACTIVE requires the ledger-confirmed requested epoch';
  END IF;
  IF NEW.state IN ('REVOKE_REQUESTED', 'EMERGENCY_HOLD') AND NEW.barrier_ordinal IS NULL THEN
    RAISE EXCEPTION 'A revoke or hold must capture the barrier ordinal';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_ledger_permission_sync_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_permission_sync
  FOR EACH ROW EXECUTE FUNCTION fn_b_permission_sync_guard();

CREATE FUNCTION fn_b_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Delivery holds cannot be deleted'; END IF;
  IF OLD.resolved_at IS NOT NULL OR NEW.resolved_at IS NULL
    OR ROW(NEW.hold_id, NEW.binding_digest, NEW.scope, NEW.permission_ref, NEW.event_id, NEW.reason, NEW.opened_at)
      IS DISTINCT FROM ROW(OLD.hold_id, OLD.binding_digest, OLD.scope, OLD.permission_ref, OLD.event_id, OLD.reason, OLD.opened_at) THEN
    RAISE EXCEPTION 'A hold can only be resolved once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_delivery_hold_guard BEFORE UPDATE OR DELETE ON delivery_hold
  FOR EACH ROW EXECUTE FUNCTION fn_b_hold_guard();

COMMIT;
