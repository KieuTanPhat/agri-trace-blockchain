-- Hybrid release C: independent organization signatures and two-party handover.
--
-- Additive on top of release B. A chain stays in handover_mode STANDARD (the
-- A/B endpoints) until an operator switches its ledger profile to DUAL_SIGNED;
-- a shipment pins that mode when it is created and never changes it, so a
-- handover can never be redirected to another protocol mid-flight.
BEGIN;

CREATE TYPE signing_key_status AS ENUM ('PENDING_LEDGER', 'ACTIVE', 'REVOKED');
CREATE TYPE signing_operation AS ENUM ('HANDOVER_OFFER', 'HANDOVER_CONFIRM');
CREATE TYPE signing_intent_status AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED');
CREATE TYPE handover_mode AS ENUM ('STANDARD', 'DUAL_SIGNED');
CREATE TYPE handover_kind AS ENUM ('PICKUP', 'ARRIVAL');
CREATE TYPE handover_state AS ENUM ('OFFERED', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE handover_custody_label AS ENUM ('CROSS_ORG', 'INTERNAL_SAME_ORG');
ALTER TYPE ledger_control_operation ADD VALUE 'SIGNING_KEY_REVOKE';

-------------------------------------------------------------------------------
-- Organization signing keys (Ed25519, proof of possession, ledger registry)
-------------------------------------------------------------------------------
-- The private key never reaches this database: only the SPKI public key and
-- the proof-of-possession signature are stored. A key is scoped to one binding
-- and one organization, mirrors the ledger registry record, and is rotated by
-- registering a new key (a revoked key is never reactivated).
CREATE TABLE signing_key (
  key_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL,
  binding_digest varchar(64) NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization (organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  label varchar(100) NOT NULL,
  algorithm varchar(10) NOT NULL DEFAULT 'Ed25519' CHECK (algorithm = 'Ed25519'),
  public_key varchar(59) NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]{59}$'),
  public_key_hash varchar(64) NOT NULL CHECK (public_key_hash ~ '^[a-f0-9]{64}$'),
  pop_signature varchar(86) NOT NULL CHECK (pop_signature ~ '^[A-Za-z0-9_-]{86}$'),
  status signing_key_status NOT NULL DEFAULT 'PENDING_LEDGER',
  registered_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  activated_at timestamptz(6),
  revoked_at timestamptz(6),
  revoke_reason text,
  FOREIGN KEY (binding_digest, chain_id) REFERENCES fabric_network_binding (digest, chain_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (registered_by, organization_id) REFERENCES app_user (user_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT uq_signing_key_public UNIQUE (binding_digest, public_key_hash),
  CONSTRAINT uq_signing_key_scope UNIQUE (key_ref, binding_digest, organization_id),
  CONSTRAINT ck_signing_key_lifecycle CHECK (
    (status = 'PENDING_LEDGER' AND activated_at IS NULL AND revoked_at IS NULL) OR
    (status = 'ACTIVE' AND activated_at IS NOT NULL AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL))
);
CREATE INDEX ix_signing_key_org ON signing_key (chain_id, organization_id, status);

ALTER TABLE ledger_control_job ADD COLUMN signing_key_ref uuid REFERENCES signing_key (key_ref) ON UPDATE NO ACTION ON DELETE RESTRICT;
ALTER TABLE ledger_control_job DROP CONSTRAINT ledger_control_job_check;
-- The new enum value cannot be named in this transaction, hence ::text.
ALTER TABLE ledger_control_job ADD CONSTRAINT ck_ledger_control_job_target CHECK (
  (operation::text = 'FENCE_DELIVERY' AND event_id IS NOT NULL AND permission_ref IS NULL AND epoch IS NULL AND signing_key_ref IS NULL) OR
  (operation::text = 'SIGNING_KEY_REVOKE' AND signing_key_ref IS NOT NULL AND event_id IS NULL AND permission_ref IS NULL AND epoch IS NULL) OR
  (operation::text IN ('PERMISSION_GRANT', 'PERMISSION_REVOKE', 'PERMISSION_EMERGENCY_REVOKE')
    AND permission_ref IS NOT NULL AND epoch IS NOT NULL AND event_id IS NULL AND signing_key_ref IS NULL));

-------------------------------------------------------------------------------
-- Signing intents (what a human or remote signer was shown and signed)
-------------------------------------------------------------------------------
-- The intent body is prepared by the API, shown to the signer, signed with the
-- organization key and consumed exactly once together with the domain write.
CREATE TABLE signing_intent (
  intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL,
  binding_digest varchar(64) NOT NULL,
  organization_id uuid NOT NULL,
  key_ref uuid NOT NULL,
  created_by uuid NOT NULL,
  operation signing_operation NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id uuid NOT NULL,
  event_id uuid NOT NULL UNIQUE,
  event_type varchar(100) NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  payload jsonb NOT NULL,
  payload_digest varchar(64) NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  intent jsonb NOT NULL,
  intent_digest varchar(64) NOT NULL UNIQUE CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  policy_version varchar(10) NOT NULL,
  expires_at timestamptz(6) NOT NULL,
  status signing_intent_status NOT NULL DEFAULT 'PENDING',
  signature varchar(86) CHECK (signature ~ '^[A-Za-z0-9_-]{86}$'),
  consumed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (chain_id) REFERENCES supply_chain (chain_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (key_ref, binding_digest, organization_id) REFERENCES signing_key (key_ref, binding_digest, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (created_by, organization_id) REFERENCES app_user (user_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ck_signing_intent_consumed CHECK ((status = 'CONSUMED') = (signature IS NOT NULL AND consumed_at IS NOT NULL)),
  CONSTRAINT ck_signing_intent_event CHECK (
    (operation = 'HANDOVER_OFFER' AND event_type = 'HANDOVER_OFFERED') OR
    (operation = 'HANDOVER_CONFIRM' AND event_type = 'HANDOVER_CONFIRMED'))
);
CREATE INDEX ix_signing_intent_entity ON signing_intent (entity_type, entity_id, created_at);

-------------------------------------------------------------------------------
-- Signature attached to a trace event (release C evidence)
-------------------------------------------------------------------------------
ALTER TABLE event_binding_context DROP CONSTRAINT event_binding_context_commitment_version_check;
ALTER TABLE event_binding_context ADD CONSTRAINT ck_event_binding_commitment CHECK (commitment_version IN ('b1', 'c1'));

CREATE TABLE event_actor_signature (
  event_id uuid PRIMARY KEY REFERENCES trace_event (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  intent_id uuid NOT NULL UNIQUE REFERENCES signing_intent (intent_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  key_ref uuid NOT NULL,
  binding_digest varchar(64) NOT NULL,
  organization_id uuid NOT NULL,
  algorithm varchar(10) NOT NULL DEFAULT 'Ed25519' CHECK (algorithm = 'Ed25519'),
  intent_digest varchar(64) NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  assertion_digest varchar(64) NOT NULL CHECK (assertion_digest ~ '^[a-f0-9]{64}$'),
  signature varchar(86) NOT NULL CHECK (signature ~ '^[A-Za-z0-9_-]{86}$'),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (key_ref, binding_digest, organization_id) REFERENCES signing_key (key_ref, binding_digest, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT
);

-------------------------------------------------------------------------------
-- Handover profile of a chain and of each shipment
-------------------------------------------------------------------------------
ALTER TABLE chain_ledger_profile ADD COLUMN handover_mode handover_mode NOT NULL DEFAULT 'STANDARD';
ALTER TABLE shipment ADD COLUMN handover_mode handover_mode NOT NULL DEFAULT 'STANDARD';

CREATE TABLE shipment_handover (
  handover_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES shipment (shipment_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  chain_id uuid NOT NULL REFERENCES supply_chain (chain_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  kind handover_kind NOT NULL,
  state handover_state NOT NULL DEFAULT 'OFFERED',
  giver_org_id uuid NOT NULL REFERENCES organization (organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  receiver_org_id uuid NOT NULL REFERENCES organization (organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  custody_label handover_custody_label NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit varchar(30) NOT NULL,
  shipment_version integer NOT NULL CHECK (shipment_version >= 0),
  lot_version integer NOT NULL CHECK (lot_version >= 0),
  offer_intent_id uuid NOT NULL UNIQUE REFERENCES signing_intent (intent_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  confirm_intent_id uuid UNIQUE REFERENCES signing_intent (intent_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  offer_event_id uuid NOT NULL UNIQUE REFERENCES trace_event (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  resolve_event_id uuid UNIQUE REFERENCES trace_event (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  offered_by uuid NOT NULL REFERENCES app_user (user_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  resolved_by uuid REFERENCES app_user (user_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  note text,
  reason text,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  offered_at timestamptz(6) NOT NULL DEFAULT now(),
  expires_at timestamptz(6) NOT NULL,
  resolved_at timestamptz(6),
  CONSTRAINT ck_handover_label CHECK ((custody_label = 'INTERNAL_SAME_ORG') = (giver_org_id = receiver_org_id)),
  CONSTRAINT ck_handover_confirm CHECK ((state = 'CONFIRMED') = (confirm_intent_id IS NOT NULL)),
  CONSTRAINT ck_handover_resolved CHECK ((state = 'OFFERED') = (resolved_at IS NULL)),
  CONSTRAINT ck_handover_expiry CHECK (expires_at > offered_at)
);
-- One open offer per shipment, and one confirmed handover per shipment and kind.
CREATE UNIQUE INDEX ux_handover_open ON shipment_handover (shipment_id) WHERE state = 'OFFERED';
CREATE UNIQUE INDEX ux_handover_confirmed ON shipment_handover (shipment_id, kind) WHERE state = 'CONFIRMED';
CREATE INDEX ix_handover_chain ON shipment_handover (chain_id, state);

-------------------------------------------------------------------------------
-- Guards
-------------------------------------------------------------------------------
CREATE TRIGGER trg_event_actor_signature_immutable BEFORE UPDATE OR DELETE ON event_actor_signature
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

CREATE FUNCTION fn_c_signing_key_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Signing keys are never deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_LEDGER' OR NEW.version <> 0 THEN
      RAISE EXCEPTION 'A signing key starts PENDING_LEDGER at version 0';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM chain_membership m
      WHERE m.chain_id = NEW.chain_id AND m.organization_id = NEW.organization_id AND m.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'The key organization must be an active member of the chain';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.key_ref, NEW.chain_id, NEW.binding_digest, NEW.organization_id, NEW.label, NEW.algorithm,
         NEW.public_key, NEW.public_key_hash, NEW.pop_signature, NEW.registered_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.key_ref, OLD.chain_id, OLD.binding_digest, OLD.organization_id, OLD.label, OLD.algorithm,
         OLD.public_key, OLD.public_key_hash, OLD.pop_signature, OLD.registered_by, OLD.created_at)
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Signing key identity is immutable; changes need a version';
  END IF;
  IF NOT (
    (OLD.status = 'PENDING_LEDGER' AND NEW.status IN ('ACTIVE', 'REVOKED')) OR
    (OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED')) THEN
    RAISE EXCEPTION 'Illegal signing key transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_signing_key_guard BEFORE INSERT OR UPDATE OR DELETE ON signing_key
  FOR EACH ROW EXECUTE FUNCTION fn_c_signing_key_guard();

CREATE FUNCTION fn_c_signing_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key_status signing_key_status;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Signing intents are never deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.signature IS NOT NULL THEN
      RAISE EXCEPTION 'A signing intent starts PENDING and unsigned';
    END IF;
    SELECT status INTO key_status FROM signing_key WHERE key_ref = NEW.key_ref;
    IF key_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Signing key is not ACTIVE'; END IF;
    IF NEW.expires_at <= now() OR NEW.expires_at > now() + interval '7 days' THEN
      RAISE EXCEPTION 'Intent expiry must be within the next 7 days';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.intent_id, NEW.chain_id, NEW.binding_digest, NEW.organization_id, NEW.key_ref, NEW.created_by,
         NEW.operation, NEW.entity_type, NEW.entity_id, NEW.event_id, NEW.event_type, NEW.expected_version,
         NEW.payload, NEW.payload_digest, NEW.intent, NEW.intent_digest, NEW.policy_version, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.intent_id, OLD.chain_id, OLD.binding_digest, OLD.organization_id, OLD.key_ref, OLD.created_by,
         OLD.operation, OLD.entity_type, OLD.entity_id, OLD.event_id, OLD.event_type, OLD.expected_version,
         OLD.payload, OLD.payload_digest, OLD.intent, OLD.intent_digest, OLD.policy_version, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'A signing intent is immutable once prepared';
  END IF;
  IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'A consumed or expired intent cannot change'; END IF;
  IF NEW.status = 'CONSUMED' THEN
    SELECT status INTO key_status FROM signing_key WHERE key_ref = NEW.key_ref;
    IF key_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Signing key is no longer ACTIVE'; END IF;
    IF now() >= NEW.expires_at THEN RAISE EXCEPTION 'Signing intent has expired'; END IF;
  ELSIF NEW.status = 'EXPIRED' THEN
    IF now() < NEW.expires_at THEN RAISE EXCEPTION 'Signing intent has not expired yet'; END IF;
    IF NEW.signature IS NOT NULL THEN RAISE EXCEPTION 'An expired intent carries no signature'; END IF;
  ELSE
    RAISE EXCEPTION 'Illegal signing intent transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_signing_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON signing_intent
  FOR EACH ROW EXECUTE FUNCTION fn_c_signing_intent_guard();

-- A consumed intent is only meaningful together with the event it authorized.
CREATE FUNCTION fn_c_intent_event_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CONSUMED' AND NOT EXISTS (
    SELECT 1 FROM event_actor_signature s WHERE s.intent_id = NEW.intent_id AND s.event_id = NEW.event_id) THEN
    RAISE EXCEPTION 'A consumed intent needs its signed trace event';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_signing_intent_event_complete AFTER INSERT OR UPDATE ON signing_intent
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_c_intent_event_complete();

-- The signature row must restate exactly the consumed intent and the event's
-- own binding; it cannot be attached to another event or key.
CREATE FUNCTION fn_c_event_signature_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i signing_intent%ROWTYPE; ctx event_binding_context%ROWTYPE; e trace_event%ROWTYPE;
BEGIN
  SELECT * INTO i FROM signing_intent WHERE intent_id = NEW.intent_id;
  SELECT * INTO ctx FROM event_binding_context WHERE event_id = NEW.event_id;
  SELECT * INTO e FROM trace_event WHERE event_id = NEW.event_id;
  IF i.status IS DISTINCT FROM 'CONSUMED' OR i.event_id <> NEW.event_id OR i.intent_digest <> NEW.intent_digest
     OR i.key_ref <> NEW.key_ref OR i.binding_digest <> NEW.binding_digest OR i.organization_id <> NEW.organization_id
     OR i.signature IS DISTINCT FROM NEW.signature THEN
    RAISE EXCEPTION 'Event signature must restate its consumed intent';
  END IF;
  IF ctx.event_id IS NULL OR ctx.commitment_version <> 'c1' OR ctx.binding_digest <> NEW.binding_digest THEN
    RAISE EXCEPTION 'Signed events need a c1 binding context on the same binding';
  END IF;
  IF e.entity_type <> i.entity_type OR e.entity_id <> i.entity_id OR e.event_type <> i.event_type THEN
    RAISE EXCEPTION 'Signed event differs from the intent it claims to carry';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_event_actor_signature_scope BEFORE INSERT ON event_actor_signature
  FOR EACH ROW EXECUTE FUNCTION fn_c_event_signature_guard();

-- c1 events carry a signature; b1 events and handover events cannot lack one.
CREATE FUNCTION fn_c_context_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.commitment_version = 'c1') <> EXISTS (SELECT 1 FROM event_actor_signature s WHERE s.event_id = NEW.event_id) THEN
    RAISE EXCEPTION 'A c1 binding context needs exactly one event signature (and b1 none)';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_event_binding_context_signature AFTER INSERT ON event_binding_context
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_c_context_signature();

CREATE FUNCTION fn_c_signed_event_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type IN ('HANDOVER_OFFERED', 'HANDOVER_CONFIRMED')
     AND NOT EXISTS (SELECT 1 FROM event_actor_signature s WHERE s.event_id = NEW.event_id) THEN
    RAISE EXCEPTION '% requires an organization signature', NEW.event_type;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_trace_event_signature_required AFTER INSERT ON trace_event
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_c_signed_event_required();

-- The handover mode of a chain only changes between handovers and with a
-- usable signer, so no handover ever changes protocol while it is open.
CREATE FUNCTION fn_c_profile_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.handover_mode IS NOT DISTINCT FROM OLD.handover_mode THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM shipment_handover h WHERE h.chain_id = NEW.chain_id AND h.state = 'OFFERED') THEN
    RAISE EXCEPTION 'The handover mode cannot change while a handover is open';
  END IF;
  IF NEW.handover_mode = 'DUAL_SIGNED' THEN
    IF NEW.active_binding_digest IS NULL THEN
      RAISE EXCEPTION 'DUAL_SIGNED needs an active binding';
    END IF;
    IF (SELECT count(DISTINCT k.organization_id) FROM signing_key k
        WHERE k.binding_digest = NEW.active_binding_digest AND k.status = 'ACTIVE') < 1 THEN
      RAISE EXCEPTION 'DUAL_SIGNED needs at least one ACTIVE signing key on the binding';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chain_ledger_profile_mode BEFORE UPDATE ON chain_ledger_profile
  FOR EACH ROW EXECUTE FUNCTION fn_c_profile_mode_guard();

-- A shipment pins the chain's mode when it is created; it cannot change, and a
-- DUAL_SIGNED shipment only moves through custody transitions that a confirmed
-- handover authorizes. Direct updates (including the A/B endpoints) fail here.
CREATE FUNCTION fn_c_shipment_mode() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chain_mode handover_mode; need handover_kind;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.handover_mode INTO chain_mode
      FROM lot l JOIN harvest_event h ON h.harvest_id = l.harvest_id
      JOIN production_cycle c ON c.cycle_id = h.cycle_id
      JOIN chain_ledger_profile p ON p.chain_id = c.chain_id
      WHERE l.lot_id = NEW.lot_id;
    NEW.handover_mode := coalesce(chain_mode, 'STANDARD');
    RETURN NEW;
  END IF;
  IF NEW.handover_mode IS DISTINCT FROM OLD.handover_mode THEN
    RAISE EXCEPTION 'The shipment handover mode is pinned at creation';
  END IF;
  IF NEW.handover_mode = 'DUAL_SIGNED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    need := CASE
      WHEN OLD.status = 'CREATED' AND NEW.status = 'IN_TRANSIT' THEN 'PICKUP'::handover_kind
      WHEN OLD.status = 'IN_TRANSIT' AND NEW.status = 'ARRIVED' THEN 'ARRIVAL'::handover_kind
      ELSE NULL END;
    IF need IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM shipment_handover h
      WHERE h.shipment_id = NEW.shipment_id AND h.kind = need AND h.state = 'CONFIRMED'
        AND h.shipment_version = OLD.version AND h.resolved_at IS NOT NULL) THEN
      RAISE EXCEPTION 'A DUAL_SIGNED shipment needs a confirmed % handover for this transition', need;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_shipment_handover_mode BEFORE INSERT OR UPDATE ON shipment
  FOR EACH ROW EXECUTE FUNCTION fn_c_shipment_mode();

CREATE FUNCTION fn_c_handover_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s shipment%ROWTYPE; l lot%ROWTYPE; cycle_chain uuid;
  offer signing_intent%ROWTYPE; confirm signing_intent%ROWTYPE; actor_org uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Handover history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO s FROM shipment WHERE shipment_id = NEW.shipment_id FOR SHARE;
    SELECT * INTO l FROM lot WHERE lot_id = s.lot_id FOR SHARE;
    SELECT c.chain_id INTO cycle_chain FROM harvest_event h JOIN production_cycle c ON c.cycle_id = h.cycle_id
      WHERE h.harvest_id = l.harvest_id;
    IF s.handover_mode <> 'DUAL_SIGNED' THEN RAISE EXCEPTION 'Only DUAL_SIGNED shipments use handovers'; END IF;
    IF NEW.state <> 'OFFERED' OR NEW.version <> 0 OR NEW.confirm_intent_id IS NOT NULL THEN
      RAISE EXCEPTION 'A handover starts as an unconfirmed offer';
    END IF;
    IF NEW.chain_id IS DISTINCT FROM cycle_chain THEN RAISE EXCEPTION 'Handover chain differs from the shipment chain'; END IF;
    IF NEW.kind = 'PICKUP' THEN
      IF s.status <> 'CREATED' OR NEW.giver_org_id <> l.farm_org_id OR NEW.receiver_org_id <> s.transporter_org_id THEN
        RAISE EXCEPTION 'Pickup is offered by the producer to the transporter of a created shipment';
      END IF;
    ELSE
      IF s.status <> 'IN_TRANSIT' OR NEW.giver_org_id <> s.transporter_org_id OR NEW.receiver_org_id <> s.retailer_org_id THEN
        RAISE EXCEPTION 'Arrival is offered by the transporter to the retailer of an in-transit shipment';
      END IF;
    END IF;
    IF NEW.shipment_version <> s.version OR NEW.lot_version <> l.version
       OR NEW.quantity <> s.shipped_quantity OR NEW.quantity <> l.available_quantity OR NEW.unit <> s.unit THEN
      RAISE EXCEPTION 'The offer must restate the current shipment version, lot version and quantity';
    END IF;
    SELECT * INTO offer FROM signing_intent WHERE intent_id = NEW.offer_intent_id;
    IF offer.status IS DISTINCT FROM 'CONSUMED' OR offer.operation <> 'HANDOVER_OFFER' OR offer.organization_id <> NEW.giver_org_id
       OR offer.entity_id <> NEW.shipment_id OR offer.event_id <> NEW.offer_event_id
       OR offer.expected_version <> NEW.shipment_version OR offer.created_by <> NEW.offered_by THEN
      RAISE EXCEPTION 'The offer must be backed by the giver signed intent for this shipment version';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.handover_id, NEW.shipment_id, NEW.chain_id, NEW.kind, NEW.giver_org_id, NEW.receiver_org_id,
         NEW.custody_label, NEW.quantity, NEW.unit, NEW.shipment_version, NEW.lot_version, NEW.offer_intent_id,
         NEW.offer_event_id, NEW.offered_by, NEW.note, NEW.offered_at, NEW.expires_at)
     IS DISTINCT FROM
     ROW(OLD.handover_id, OLD.shipment_id, OLD.chain_id, OLD.kind, OLD.giver_org_id, OLD.receiver_org_id,
         OLD.custody_label, OLD.quantity, OLD.unit, OLD.shipment_version, OLD.lot_version, OLD.offer_intent_id,
         OLD.offer_event_id, OLD.offered_by, OLD.note, OLD.offered_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'The offered handover terms are immutable';
  END IF;
  IF OLD.state <> 'OFFERED' THEN RAISE EXCEPTION 'A resolved handover cannot change'; END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.resolved_at IS NULL OR NEW.resolved_by IS NULL THEN
    RAISE EXCEPTION 'A resolution needs a version, a time and a user';
  END IF;
  SELECT organization_id INTO actor_org FROM app_user WHERE user_id = NEW.resolved_by;
  IF NEW.state = 'CONFIRMED' THEN
    SELECT * INTO s FROM shipment WHERE shipment_id = NEW.shipment_id FOR SHARE;
    SELECT * INTO l FROM lot WHERE lot_id = s.lot_id FOR SHARE;
    SELECT * INTO confirm FROM signing_intent WHERE intent_id = NEW.confirm_intent_id;
    IF confirm.status IS DISTINCT FROM 'CONSUMED' OR confirm.operation <> 'HANDOVER_CONFIRM'
       OR confirm.organization_id <> NEW.receiver_org_id OR confirm.entity_id <> NEW.shipment_id
       OR confirm.expected_version <> NEW.shipment_version OR confirm.event_id IS DISTINCT FROM NEW.resolve_event_id
       OR confirm.created_by <> NEW.resolved_by THEN
      RAISE EXCEPTION 'Confirmation must be backed by the receiver signed intent for the offered version';
    END IF;
    IF NEW.resolved_at >= NEW.expires_at THEN RAISE EXCEPTION 'The offer has expired'; END IF;
    IF s.version <> NEW.shipment_version OR l.version <> NEW.lot_version OR l.available_quantity <> NEW.quantity THEN
      RAISE EXCEPTION 'The shipment or lot changed after the offer; confirmation is stale';
    END IF;
  ELSIF NEW.state = 'REJECTED' THEN
    IF actor_org <> NEW.receiver_org_id THEN RAISE EXCEPTION 'Only the receiver can reject an offer'; END IF;
  ELSIF NEW.state = 'CANCELLED' THEN
    IF actor_org <> NEW.giver_org_id THEN RAISE EXCEPTION 'Only the giver can cancel an offer'; END IF;
  ELSIF NEW.state = 'EXPIRED' THEN
    IF NEW.resolved_at < NEW.expires_at THEN RAISE EXCEPTION 'The offer has not expired yet'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_shipment_handover_guard BEFORE INSERT OR UPDATE OR DELETE ON shipment_handover
  FOR EACH ROW EXECUTE FUNCTION fn_c_handover_guard();

COMMIT;
