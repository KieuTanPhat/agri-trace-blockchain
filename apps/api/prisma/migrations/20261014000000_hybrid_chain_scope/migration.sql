-- Hybrid release A: supply-chain scope, capabilities, scoped grants, stage
-- assignments, immutable ShipmentPlan and per-event ledger routes.
--
-- Existing data is backfilled deterministically into one legacy chain per FARM
-- organization that already owns production cycles. Trace events, hashes,
-- proofs, QR tokens and journals are never rewritten; scope is added through
-- sidecar rows only. After this migration every production cycle has a chain.
BEGIN;

-- Block writers while the legacy inventory is mapped.
LOCK TABLE organization, app_user, production_cycle, lot, shipment, trace_event
  IN SHARE ROW EXCLUSIVE MODE;

-------------------------------------------------------------------------------
-- 1. Types and tables
-------------------------------------------------------------------------------
CREATE TYPE "ChainMembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "GrantScope" AS ENUM ('ORGANIZATION', 'CHAIN');
CREATE TYPE "ScopedRole" AS ENUM ('ORG_ADMIN', 'CREATE_CHAIN', 'CHAIN_MANAGER', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR', 'COMPLIANCE_REVIEWER');
CREATE TYPE hybrid_business_profile_state AS ENUM ('PREPARING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE hybrid_stage AS ENUM ('PRODUCTION', 'TRANSPORT', 'RETAIL');
CREATE TYPE hybrid_assignment_state AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'CANCELLED');
CREATE TYPE hybrid_shipment_plan_state AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');
CREATE TYPE hybrid_plan_party AS ENUM ('PRODUCER', 'TRANSPORTER', 'RETAILER');

CREATE UNIQUE INDEX uq_user_org_scope ON app_user (user_id, organization_id);

CREATE TABLE organization_capability (
  organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE CASCADE,
  code organization_type NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (organization_id, code)
);

CREATE TABLE supply_chain (
  chain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  name varchar(255) NOT NULL CHECK (length(btrim(name)) > 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX supply_chain_owner_organization_id_idx ON supply_chain (owner_organization_id);

CREATE TABLE chain_membership (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  status "ChainMembershipStatus" NOT NULL DEFAULT 'INVITED',
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  invitation_revision integer NOT NULL DEFAULT 0 CHECK (invitation_revision >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_chain_membership_org UNIQUE (chain_id, organization_id)
);
CREATE INDEX chain_membership_organization_id_status_idx ON chain_membership (organization_id, status);

CREATE TABLE scoped_role_grant (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  chain_id uuid REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  scope "GrantScope" NOT NULL,
  role "ScopedRole" NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6),
  FOREIGN KEY (user_id, organization_id) REFERENCES app_user (user_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (chain_id, organization_id) REFERENCES chain_membership (chain_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ck_scoped_role_kind CHECK (
    (scope = 'ORGANIZATION' AND chain_id IS NULL AND role IN ('ORG_ADMIN', 'CREATE_CHAIN')) OR
    (scope = 'CHAIN' AND chain_id IS NOT NULL AND role NOT IN ('ORG_ADMIN', 'CREATE_CHAIN'))
  )
);
CREATE UNIQUE INDEX uq_scoped_role_org_active ON scoped_role_grant (user_id, organization_id, role) WHERE chain_id IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX uq_scoped_role_chain_active ON scoped_role_grant (user_id, organization_id, chain_id, role) WHERE chain_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX scoped_role_grant_user_id_revoked_at_idx ON scoped_role_grant (user_id, revoked_at);
CREATE INDEX scoped_role_grant_chain_id_organization_id_idx ON scoped_role_grant (chain_id, organization_id);

CREATE TABLE chain_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES app_user ON UPDATE NO ACTION ON DELETE RESTRICT,
  operation varchar(80) NOT NULL,
  subject_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX chain_audit_chain_id_created_at_idx ON chain_audit (chain_id, created_at);

CREATE TABLE chain_business_profile (
  chain_id uuid PRIMARY KEY REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  state hybrid_business_profile_state NOT NULL DEFAULT 'PREPARING',
  scope_version integer NOT NULL DEFAULT 1 CHECK (scope_version = 1),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

-- Identity/scope revocation must remain distinguishable after reactivation.
-- Telemetry lastSeenAt updates do not create a new authorization epoch.
ALTER TABLE iot_device ADD COLUMN authority_revision integer NOT NULL DEFAULT 0 CHECK (authority_revision >= 0);

-- Nullable only until the backfill below; SET NOT NULL follows.
ALTER TABLE production_cycle ADD COLUMN chain_id uuid REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_cycle_chain_scope ON production_cycle (cycle_id, chain_id);
CREATE INDEX ix_cycle_chain_scope ON production_cycle (chain_id);

CREATE TABLE stage_assignment (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  stage hybrid_stage NOT NULL,
  cycle_id uuid,
  lot_id uuid REFERENCES lot ON UPDATE NO ACTION ON DELETE RESTRICT,
  shipment_id uuid REFERENCES shipment ON UPDATE NO ACTION ON DELETE RESTRICT,
  status hybrid_assignment_state NOT NULL DEFAULT 'PROPOSED',
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (chain_id, organization_id) REFERENCES chain_membership (chain_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (cycle_id, chain_id) REFERENCES production_cycle (cycle_id, chain_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CHECK (
    (stage = 'PRODUCTION' AND cycle_id IS NOT NULL AND lot_id IS NULL AND shipment_id IS NULL) OR
    (stage = 'TRANSPORT' AND cycle_id IS NULL AND lot_id IS NULL AND shipment_id IS NOT NULL) OR
    (stage = 'RETAIL' AND cycle_id IS NULL AND lot_id IS NOT NULL AND shipment_id IS NULL)
  )
);
CREATE UNIQUE INDEX uq_stage_cycle_active ON stage_assignment (chain_id, cycle_id, stage) WHERE status IN ('PROPOSED', 'ACCEPTED');
CREATE UNIQUE INDEX uq_stage_lot_active ON stage_assignment (chain_id, lot_id, stage) WHERE status IN ('PROPOSED', 'ACCEPTED');
CREATE UNIQUE INDEX uq_stage_shipment_active ON stage_assignment (chain_id, shipment_id, stage) WHERE status IN ('PROPOSED', 'ACCEPTED');
CREATE INDEX ix_stage_actor_scope ON stage_assignment (chain_id, organization_id, stage, status);

CREATE TABLE shipment_plan (
  plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES lot ON UPDATE NO ACTION ON DELETE RESTRICT,
  current_revision integer NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  status hybrid_shipment_plan_state NOT NULL DEFAULT 'DRAFT',
  shipment_id uuid REFERENCES shipment ON UPDATE NO ACTION ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT shipment_plan_shipment_id_key UNIQUE (shipment_id),
  CHECK ((status = 'FINALIZED') = (shipment_id IS NOT NULL))
);
CREATE INDEX ix_plan_chain_lot ON shipment_plan (chain_id, lot_id, status);

CREATE TABLE shipment_plan_revision (
  plan_id uuid NOT NULL REFERENCES shipment_plan ON UPDATE NO ACTION ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision >= 0),
  producer_org_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  transporter_org_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  retailer_org_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(30) NOT NULL CHECK (length(btrim(unit)) > 0),
  origin text NOT NULL CHECK (length(btrim(origin)) > 0),
  destination text NOT NULL CHECK (length(btrim(destination)) > 0),
  vehicle_ref text,
  planned_pickup_time timestamptz(6),
  expected_arrival_time timestamptz(6),
  payload_digest varchar(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, revision),
  CHECK (planned_pickup_time IS NULL OR expected_arrival_time IS NULL OR expected_arrival_time >= planned_pickup_time)
);
ALTER TABLE shipment_plan ADD CONSTRAINT fk_plan_current_revision
  FOREIGN KEY (plan_id, current_revision) REFERENCES shipment_plan_revision (plan_id, revision)
  ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE shipment_plan_acceptance (
  acceptance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  revision integer NOT NULL,
  party hybrid_plan_party NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES scoped_role_grant ON UPDATE NO ACTION ON DELETE RESTRICT,
  grant_revision integer NOT NULL CHECK (grant_revision >= 0),
  accepted_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id, revision) REFERENCES shipment_plan_revision (plan_id, revision) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (user_id, organization_id) REFERENCES app_user (user_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT shipment_plan_acceptance_plan_id_revision_party_key UNIQUE (plan_id, revision, party)
);

CREATE TABLE event_chain_context (
  event_id uuid PRIMARY KEY REFERENCES trace_event ON UPDATE NO ACTION ON DELETE RESTRICT,
  chain_id uuid NOT NULL REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  scope_version integer NOT NULL DEFAULT 1 CHECK (scope_version = 1),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE ledger_route_definition (
  digest varchar(64) PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  protocol varchar(50) NOT NULL DEFAULT 'agritrace-ledger-route/1'
    CHECK (protocol IN ('agritrace-ledger-route/1', 'agritrace-ledger-route/2')),
  mode varchar(16) NOT NULL CHECK (mode IN ('WRITE', 'HISTORICAL')),
  network varchar(100) NOT NULL CHECK (network ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  channel_id varchar(100) NOT NULL CHECK (channel_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  chaincode_name varchar(100) NOT NULL CHECK (chaincode_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  contract_name varchar(100) NOT NULL CHECK (contract_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  envelope_version varchar(50),
  writer_authority varchar(100),
  writer_msp_id varchar(100),
  writer_role varchar(50),
  -- Route protocol 2 (release B) additionally pins the chain reference and the
  -- immutable logical binding digest; the binding table references this row.
  chain_ref uuid,
  binding_digest varchar(64) CHECK (binding_digest IS NULL OR binding_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(writer_authority, writer_msp_id, writer_role) IN (0, 3)),
  CHECK (writer_authority IS NULL OR (writer_authority ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' AND writer_msp_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' AND writer_role ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$')),
  CHECK (envelope_version IS NULL OR envelope_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$'),
  CHECK (
    (protocol = 'agritrace-ledger-route/1' AND chain_ref IS NULL AND binding_digest IS NULL
      AND (mode = 'HISTORICAL' OR (envelope_version = '3.0.0' AND writer_authority IS NOT NULL AND writer_role = 'relayer')))
    OR
    (protocol = 'agritrace-ledger-route/2' AND mode = 'WRITE' AND envelope_version = '4.0.0'
      AND writer_authority IS NOT NULL AND writer_role = 'relayer'
      AND chain_ref IS NOT NULL AND binding_digest IS NOT NULL)
  )
);

CREATE TABLE event_ledger_route (
  event_id uuid PRIMARY KEY REFERENCES trace_event (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  definition_digest varchar(64) NOT NULL REFERENCES ledger_route_definition (digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX ix_event_ledger_route_definition ON event_ledger_route (definition_digest);

-------------------------------------------------------------------------------
-- 2. Deterministic backfill of existing data (no trace/proof rewrite)
-------------------------------------------------------------------------------
INSERT INTO organization_capability (organization_id, code)
SELECT organization_id, type FROM organization;

-- One legacy chain per FARM organization that already has production cycles.
CREATE TEMP TABLE legacy_chain ON COMMIT DROP AS
SELECT gen_random_uuid() AS chain_id, o.organization_id AS owner_id, o.name
FROM organization o
WHERE EXISTS (SELECT 1 FROM production_cycle c WHERE c.farm_org_id = o.organization_id);

INSERT INTO supply_chain (chain_id, owner_organization_id, name)
SELECT chain_id, owner_id, left('Chuỗi legacy - ' || name, 255) FROM legacy_chain;
INSERT INTO chain_business_profile (chain_id, state)
SELECT chain_id, 'ACTIVE' FROM legacy_chain;

-- Members: owner, every transporter/retailer that handled one of its Lots and
-- every auditor organization holding a compliance assignment on its farms.
CREATE TEMP TABLE legacy_member ON COMMIT DROP AS
SELECT DISTINCT lc.chain_id, m.organization_id
FROM legacy_chain lc
CROSS JOIN LATERAL (
  SELECT lc.owner_id AS organization_id
  UNION
  SELECT s.transporter_org_id FROM shipment s JOIN lot l USING (lot_id)
    JOIN harvest_event h ON h.harvest_id = l.harvest_id
    JOIN production_cycle c ON c.cycle_id = h.cycle_id
    WHERE c.farm_org_id = lc.owner_id
  UNION
  SELECT s.retailer_org_id FROM shipment s JOIN lot l USING (lot_id)
    JOIN harvest_event h ON h.harvest_id = l.harvest_id
    JOIN production_cycle c ON c.cycle_id = h.cycle_id
    WHERE c.farm_org_id = lc.owner_id
  UNION
  SELECT u.organization_id FROM compliance_assignment ca
    JOIN farm f ON f.farm_id = ca.farm_id
    JOIN app_user u ON u.user_id = ca.reviewer_user_id
    WHERE f.organization_id = lc.owner_id AND ca.revoked_at IS NULL AND u.organization_id IS NOT NULL
) m;

INSERT INTO chain_membership (chain_id, organization_id, status)
SELECT chain_id, organization_id, 'ACTIVE' FROM legacy_member;

-- Organization administrator: the earliest active non-platform user of each
-- organization. Producers additionally receive CREATE_CHAIN. Platform admins
-- can reassign later through the scoped grant API.
CREATE TEMP TABLE legacy_org_admin ON COMMIT DROP AS
SELECT DISTINCT ON (u.organization_id) u.organization_id, u.user_id
FROM app_user u JOIN app_role r ON r.role_id = u.role_id
WHERE u.organization_id IS NOT NULL AND u.account_status = 'ACTIVE' AND r.code <> 'SYSTEM_ADMIN'
ORDER BY u.organization_id, u.created_at, u.user_id;

INSERT INTO scoped_role_grant (user_id, organization_id, scope, role)
SELECT user_id, organization_id, 'ORGANIZATION'::"GrantScope", 'ORG_ADMIN'::"ScopedRole" FROM legacy_org_admin;
INSERT INTO scoped_role_grant (user_id, organization_id, scope, role)
SELECT a.user_id, a.organization_id, 'ORGANIZATION'::"GrantScope", 'CREATE_CHAIN'::"ScopedRole"
FROM legacy_org_admin a JOIN organization o ON o.organization_id = a.organization_id
WHERE o.type = 'FARM';

INSERT INTO scoped_role_grant (user_id, organization_id, chain_id, scope, role)
SELECT a.user_id, lc.owner_id, lc.chain_id, 'CHAIN'::"GrantScope", 'CHAIN_MANAGER'::"ScopedRole"
FROM legacy_chain lc JOIN legacy_org_admin a ON a.organization_id = lc.owner_id;

-- Business roles follow the legacy global role inside each chain where the
-- user's organization is a member and holds the matching capability.
INSERT INTO scoped_role_grant (user_id, organization_id, chain_id, scope, role)
SELECT u.user_id, u.organization_id, m.chain_id, 'CHAIN'::"GrantScope", r.code::"ScopedRole"
FROM app_user u
JOIN app_role r ON r.role_id = u.role_id
JOIN legacy_member m ON m.organization_id = u.organization_id
JOIN organization o ON o.organization_id = u.organization_id
WHERE u.account_status = 'ACTIVE'
  AND ((r.code = 'FARM_STAFF' AND o.type = 'FARM')
    OR (r.code = 'TRANSPORTER' AND o.type = 'TRANSPORTER')
    OR (r.code = 'RETAILER' AND o.type = 'RETAILER'));

-- Legacy auditors keep read and review authority only where they were
-- assigned to a farm of the chain.
INSERT INTO scoped_role_grant (user_id, organization_id, chain_id, scope, role)
SELECT DISTINCT u.user_id, u.organization_id, lc.chain_id, 'CHAIN'::"GrantScope", g.role
FROM compliance_assignment ca
JOIN farm f ON f.farm_id = ca.farm_id
JOIN legacy_chain lc ON lc.owner_id = f.organization_id
JOIN app_user u ON u.user_id = ca.reviewer_user_id
CROSS JOIN (VALUES ('AUDITOR'::"ScopedRole"), ('COMPLIANCE_REVIEWER'::"ScopedRole")) g(role)
WHERE ca.revoked_at IS NULL AND u.account_status = 'ACTIVE' AND u.organization_id IS NOT NULL;

-- Preserve cycle timestamps: scope is added metadata, not a domain change.
ALTER TABLE production_cycle DISABLE TRIGGER trg_production_cycle_updated_at;
UPDATE production_cycle c SET chain_id = lc.chain_id
FROM legacy_chain lc WHERE lc.owner_id = c.farm_org_id;
ALTER TABLE production_cycle ENABLE TRIGGER trg_production_cycle_updated_at;
ALTER TABLE production_cycle ALTER COLUMN chain_id SET NOT NULL;

INSERT INTO stage_assignment (chain_id, organization_id, stage, cycle_id, status)
SELECT chain_id, farm_org_id, 'PRODUCTION', cycle_id, 'ACCEPTED' FROM production_cycle;
INSERT INTO stage_assignment (chain_id, organization_id, stage, shipment_id, status)
SELECT c.chain_id, s.transporter_org_id, 'TRANSPORT', s.shipment_id, 'ACCEPTED'
FROM shipment s JOIN lot l USING (lot_id)
JOIN harvest_event h ON h.harvest_id = l.harvest_id
JOIN production_cycle c ON c.cycle_id = h.cycle_id;
INSERT INTO stage_assignment (chain_id, organization_id, stage, lot_id, status)
SELECT c.chain_id, s.retailer_org_id, 'RETAIL', l.lot_id, 'ACCEPTED'
FROM shipment s JOIN lot l USING (lot_id)
JOIN harvest_event h ON h.harvest_id = l.harvest_id
JOIN production_cycle c ON c.cycle_id = h.cycle_id;

INSERT INTO event_chain_context (event_id, chain_id)
SELECT e.event_id, c.chain_id
FROM trace_event e
LEFT JOIN lot l ON l.lot_id = e.lot_id
LEFT JOIN harvest_event h ON h.harvest_id = l.harvest_id
JOIN production_cycle c ON c.cycle_id = coalesce(e.cycle_id, h.cycle_id);

-- Existing events keep no route sidecar: their destination is evidenced by the
-- stored proof (network/channel) and they are delivered by the configured
-- legacy writer. Only events created after this migration require a route.
CREATE TEMP TABLE legacy_event ON COMMIT DROP AS SELECT event_id FROM trace_event;

-------------------------------------------------------------------------------
-- 3. Guards (created after backfill so legacy rows are not re-validated)
-------------------------------------------------------------------------------
CREATE FUNCTION fn_seed_primary_capability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_capability (organization_id, code) VALUES (NEW.organization_id, NEW.type);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_seed_primary_capability AFTER INSERT ON organization
  FOR EACH ROW EXECUTE FUNCTION fn_seed_primary_capability();

CREATE FUNCTION fn_lock_chain_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Chain management audit is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER trg_lock_chain_audit BEFORE UPDATE OR DELETE ON chain_audit
  FOR EACH ROW EXECUTE FUNCTION fn_lock_chain_history();

CREATE FUNCTION fn_lock_scoped_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Grant history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.grant_id, NEW.user_id, NEW.organization_id, NEW.chain_id, NEW.scope, NEW.role, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.grant_id, OLD.user_id, OLD.organization_id, OLD.chain_id, OLD.scope, OLD.role, OLD.created_at)
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Grant may only be revoked once; issue a fresh grant to reauthorize' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lock_scoped_grant BEFORE UPDATE OR DELETE ON scoped_role_grant
  FOR EACH ROW EXECUTE FUNCTION fn_lock_scoped_grant();

CREATE FUNCTION fn_lock_chain_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_organization_id IS DISTINCT FROM OLD.owner_organization_id THEN
    RAISE EXCEPTION 'Chain ownership transfer is not supported' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lock_chain_owner BEFORE UPDATE ON supply_chain
  FOR EACH ROW EXECUTE FUNCTION fn_lock_chain_owner();

CREATE FUNCTION fn_guard_chain_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Membership history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    ROW(NEW.membership_id, NEW.chain_id, NEW.organization_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.membership_id, OLD.chain_id, OLD.organization_id, OLD.created_at)
    OR NEW.version <> OLD.version + 1
    OR NEW.invitation_revision <> OLD.invitation_revision + CASE WHEN NEW.status = 'INVITED' THEN 1 ELSE 0 END
    OR NOT ((OLD.status = 'INVITED' AND NEW.status IN ('ACTIVE', 'SUSPENDED', 'REVOKED'))
      OR (OLD.status = 'ACTIVE' AND NEW.status IN ('SUSPENDED', 'REVOKED'))
      OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('INVITED', 'REVOKED'))
      OR (OLD.status = 'REVOKED' AND NEW.status = 'INVITED'))
  ) THEN
    RAISE EXCEPTION 'Invalid membership transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id = (SELECT owner_organization_id FROM supply_chain WHERE chain_id = NEW.chain_id)
    AND NEW.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Owner membership must remain active' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_chain_membership BEFORE INSERT OR UPDATE OR DELETE ON chain_membership
  FOR EACH ROW EXECUTE FUNCTION fn_guard_chain_membership();

CREATE FUNCTION fn_validate_chain_owner_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM chain_membership WHERE chain_id = NEW.chain_id
    AND organization_id = NEW.owner_organization_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Chain requires an active owner membership' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_validate_chain_owner_membership AFTER INSERT ON supply_chain
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_validate_chain_owner_membership();

CREATE FUNCTION fn_hybrid_device_authority_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.organization_id, NEW.cycle_id, NEW.device_code, NEW.status)
    IS DISTINCT FROM (OLD.organization_id, OLD.cycle_id, OLD.device_code, OLD.status) THEN
    NEW.authority_revision := OLD.authority_revision + 1;
  ELSIF NEW.authority_revision <> OLD.authority_revision THEN
    RAISE EXCEPTION 'Device authority revision is managed by identity transitions';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_device_authority_revision BEFORE UPDATE ON iot_device
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_device_authority_revision();

CREATE FUNCTION fn_hybrid_participant(p_chain uuid, p_org uuid, p_cap organization_type)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE org_status organization_status; member_status "ChainMembershipStatus";
  cap_revoked timestamptz; profile_state hybrid_business_profile_state;
BEGIN
  SELECT status INTO org_status FROM organization WHERE organization_id = p_org FOR SHARE;
  IF org_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Hybrid organization inactive'; END IF;
  SELECT status INTO member_status FROM chain_membership
    WHERE chain_id = p_chain AND organization_id = p_org FOR SHARE;
  IF member_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Hybrid membership inactive'; END IF;
  SELECT revoked_at INTO cap_revoked FROM organization_capability
    WHERE organization_id = p_org AND code = p_cap FOR SHARE;
  IF NOT FOUND OR cap_revoked IS NOT NULL THEN RAISE EXCEPTION 'Hybrid capability unavailable'; END IF;
  SELECT state INTO profile_state FROM chain_business_profile WHERE chain_id = p_chain FOR SHARE;
  IF profile_state IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Hybrid business profile not active'; END IF;
END;
$$;

CREATE FUNCTION fn_hybrid_cycle_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.chain_id IS DISTINCT FROM OLD.chain_id THEN
      RAISE EXCEPTION 'Cycle chain scope is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.chain_id IS NULL THEN RAISE EXCEPTION 'Cycle chain scope is required'; END IF;
  PERFORM fn_hybrid_participant(NEW.chain_id, NEW.farm_org_id, 'FARM');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_cycle_scope BEFORE INSERT OR UPDATE ON production_cycle
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_cycle_scope();

CREATE FUNCTION fn_hybrid_stage_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_chain uuid; subject_org uuid; capability organization_type;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Assignment history cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.assignment_id, NEW.chain_id, NEW.organization_id, NEW.stage, NEW.cycle_id, NEW.lot_id, NEW.shipment_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.assignment_id, OLD.chain_id, OLD.organization_id, OLD.stage, OLD.cycle_id, OLD.lot_id, OLD.shipment_id, OLD.created_at)
      OR OLD.status <> 'PROPOSED' OR NEW.status NOT IN ('ACCEPTED', 'REJECTED', 'CANCELLED')
      OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Assignment subject/party immutable or transition invalid';
    END IF;
  ELSIF NEW.version <> 0 OR NEW.status NOT IN ('PROPOSED', 'ACCEPTED') THEN
    RAISE EXCEPTION 'Invalid initial assignment';
  END IF;
  IF NEW.stage = 'PRODUCTION' THEN
    SELECT chain_id, farm_org_id INTO subject_chain, subject_org FROM production_cycle WHERE cycle_id = NEW.cycle_id;
    capability := 'FARM';
  ELSIF NEW.stage = 'TRANSPORT' THEN
    SELECT c.chain_id, s.transporter_org_id INTO subject_chain, subject_org
      FROM shipment s JOIN lot l USING (lot_id) JOIN harvest_event h ON h.harvest_id = l.harvest_id
      JOIN production_cycle c USING (cycle_id) WHERE s.shipment_id = NEW.shipment_id;
    capability := 'TRANSPORTER';
  ELSE
    SELECT c.chain_id, s.retailer_org_id INTO subject_chain, subject_org
      FROM lot l JOIN shipment s USING (lot_id) JOIN harvest_event h ON h.harvest_id = l.harvest_id
      JOIN production_cycle c USING (cycle_id) WHERE l.lot_id = NEW.lot_id;
    capability := 'RETAILER';
  END IF;
  IF subject_chain IS DISTINCT FROM NEW.chain_id OR subject_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Assignment subject/chain/party mismatch';
  END IF;
  IF NEW.status IN ('PROPOSED', 'ACCEPTED') THEN
    PERFORM fn_hybrid_participant(NEW.chain_id, NEW.organization_id, capability);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_stage_scope BEFORE INSERT OR UPDATE OR DELETE ON stage_assignment
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_stage_scope();

CREATE TRIGGER trg_hybrid_revision_immutable BEFORE UPDATE OR DELETE ON shipment_plan_revision
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_hybrid_acceptance_immutable BEFORE UPDATE OR DELETE ON shipment_plan_acceptance
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_hybrid_event_context_immutable BEFORE UPDATE OR DELETE ON event_chain_context
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

CREATE FUNCTION fn_hybrid_revision_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p shipment_plan%ROWTYPE; subject_chain uuid; producer uuid; participant record;
BEGIN
  SELECT * INTO STRICT p FROM shipment_plan WHERE plan_id = NEW.plan_id FOR SHARE;
  IF p.status <> 'DRAFT' OR NEW.revision NOT IN (p.current_revision, p.current_revision + 1) THEN
    RAISE EXCEPTION 'Plan revision not writable';
  END IF;
  SELECT c.chain_id, l.farm_org_id INTO subject_chain, producer
    FROM lot l JOIN harvest_event h ON h.harvest_id = l.harvest_id
    JOIN production_cycle c USING (cycle_id) WHERE l.lot_id = p.lot_id;
  IF subject_chain IS DISTINCT FROM p.chain_id OR producer IS DISTINCT FROM NEW.producer_org_id THEN
    RAISE EXCEPTION 'Plan producer/subject/chain mismatch';
  END IF;
  FOR participant IN SELECT * FROM (VALUES
    (NEW.producer_org_id, 'FARM'::organization_type),
    (NEW.transporter_org_id, 'TRANSPORTER'::organization_type),
    (NEW.retailer_org_id, 'RETAILER'::organization_type)
  ) AS parties(org_id, capability) ORDER BY org_id, capability LOOP
    PERFORM fn_hybrid_participant(p.chain_id, participant.org_id, participant.capability);
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_revision_scope BEFORE INSERT ON shipment_plan_revision
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_revision_scope();

CREATE FUNCTION fn_hybrid_revision_current() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shipment_plan WHERE plan_id = NEW.plan_id AND current_revision = NEW.revision) THEN
    RAISE EXCEPTION 'Inserted revision must become current in the same transaction';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_hybrid_revision_current AFTER INSERT ON shipment_plan_revision
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_hybrid_revision_current();

CREATE FUNCTION fn_hybrid_acceptance_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p shipment_plan%ROWTYPE; r shipment_plan_revision%ROWTYPE;
  g scoped_role_grant%ROWTYPE; account_status_now account_status; expected_org uuid;
BEGIN
  SELECT * INTO STRICT p FROM shipment_plan WHERE plan_id = NEW.plan_id FOR SHARE;
  SELECT * INTO STRICT r FROM shipment_plan_revision WHERE plan_id = NEW.plan_id AND revision = NEW.revision;
  IF p.status <> 'DRAFT' OR p.current_revision <> NEW.revision THEN
    RAISE EXCEPTION 'Plan acceptance is stale';
  END IF;
  expected_org := CASE NEW.party WHEN 'PRODUCER' THEN r.producer_org_id
    WHEN 'TRANSPORTER' THEN r.transporter_org_id ELSE r.retailer_org_id END;
  IF expected_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Cannot accept for another party'; END IF;
  SELECT account_status INTO account_status_now FROM app_user
    WHERE user_id = NEW.user_id AND organization_id = NEW.organization_id FOR SHARE;
  IF account_status_now IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Accepting user inactive'; END IF;
  SELECT * INTO STRICT g FROM scoped_role_grant WHERE grant_id = NEW.grant_id FOR SHARE;
  IF g.user_id <> NEW.user_id OR g.organization_id <> NEW.organization_id OR g.scope <> 'ORGANIZATION'
    OR g.chain_id IS NOT NULL OR g.role <> 'ORG_ADMIN' OR g.revoked_at IS NOT NULL OR g.revision <> NEW.grant_revision THEN
    RAISE EXCEPTION 'Acceptance requires the current organization admin grant';
  END IF;
  PERFORM fn_hybrid_participant(p.chain_id, NEW.organization_id,
    CASE NEW.party WHEN 'PRODUCER' THEN 'FARM'::organization_type
      WHEN 'TRANSPORTER' THEN 'TRANSPORTER'::organization_type ELSE 'RETAILER'::organization_type END);
  NEW.accepted_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_acceptance_scope BEFORE INSERT ON shipment_plan_acceptance
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_acceptance_scope();

CREATE FUNCTION fn_hybrid_event_context_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_chain uuid; event_cycle uuid; lot_cycle uuid;
BEGIN
  SELECT e.cycle_id, h.cycle_id INTO event_cycle, lot_cycle FROM trace_event e
    LEFT JOIN lot l ON l.lot_id = e.lot_id LEFT JOIN harvest_event h ON h.harvest_id = l.harvest_id
    WHERE e.event_id = NEW.event_id;
  IF event_cycle IS NOT NULL AND lot_cycle IS NOT NULL AND event_cycle <> lot_cycle THEN
    RAISE EXCEPTION 'Event subjects disagree';
  END IF;
  SELECT chain_id INTO subject_chain FROM production_cycle WHERE cycle_id = coalesce(event_cycle, lot_cycle);
  IF subject_chain IS DISTINCT FROM NEW.chain_id THEN RAISE EXCEPTION 'Event context chain mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_event_context_scope BEFORE INSERT ON event_chain_context
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_event_context_scope();

CREATE FUNCTION fn_hybrid_plan_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_chain uuid; r shipment_plan_revision%ROWTYPE; s shipment%ROWTYPE;
  a shipment_plan_acceptance%ROWTYPE; g scoped_role_grant%ROWTYPE;
  stock numeric(14,3); producer uuid; participant record; user_active boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Shipment plan history cannot be deleted'; END IF;
  SELECT c.chain_id, l.farm_org_id, l.available_quantity INTO subject_chain, producer, stock
    FROM lot l JOIN harvest_event h ON h.harvest_id = l.harvest_id
    JOIN production_cycle c USING (cycle_id) WHERE l.lot_id = NEW.lot_id;
  IF subject_chain IS DISTINCT FROM NEW.chain_id THEN RAISE EXCEPTION 'Plan Lot belongs to another chain'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.current_revision <> 0 OR NEW.version <> 0 OR NEW.shipment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid initial plan';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.plan_id, NEW.chain_id, NEW.lot_id, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.plan_id, OLD.chain_id, OLD.lot_id, OLD.created_at)
    OR OLD.status <> 'DRAFT' OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Plan scope immutable or version/transition invalid';
  END IF;
  IF NEW.status = 'DRAFT' THEN
    IF NEW.current_revision <> OLD.current_revision + 1 OR NEW.shipment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Revise requires exactly one new revision';
    END IF;
  ELSIF NEW.status = 'CANCELLED' THEN
    IF NEW.current_revision <> OLD.current_revision OR NEW.shipment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cancel cannot rewrite plan payload';
    END IF;
  ELSE
    IF NEW.current_revision <> OLD.current_revision OR NEW.shipment_id IS NULL THEN
      RAISE EXCEPTION 'Finalize must retain the accepted revision';
    END IF;
    SELECT * INTO STRICT r FROM shipment_plan_revision WHERE plan_id = NEW.plan_id AND revision = NEW.current_revision;
    SELECT * INTO STRICT s FROM shipment WHERE shipment_id = NEW.shipment_id FOR SHARE;
    IF s.lot_id <> NEW.lot_id OR s.status <> 'CREATED' OR producer <> r.producer_org_id
      OR s.transporter_org_id <> r.transporter_org_id OR s.retailer_org_id <> r.retailer_org_id
      OR s.shipped_quantity <> r.quantity OR r.quantity <> stock OR s.unit <> r.unit
      OR s.origin <> r.origin OR s.destination <> r.destination
      OR s.vehicle_ref IS DISTINCT FROM r.vehicle_ref
      OR s.planned_pickup_time IS DISTINCT FROM r.planned_pickup_time
      OR s.expected_arrival_time IS DISTINCT FROM r.expected_arrival_time THEN
      RAISE EXCEPTION 'Finalized Shipment differs from the current plan or available stock';
    END IF;
    FOR participant IN SELECT * FROM (VALUES
      ('PRODUCER'::hybrid_plan_party, r.producer_org_id, 'FARM'::organization_type),
      ('TRANSPORTER'::hybrid_plan_party, r.transporter_org_id, 'TRANSPORTER'::organization_type),
      ('RETAILER'::hybrid_plan_party, r.retailer_org_id, 'RETAILER'::organization_type)
    ) AS parties(party, org_id, capability) ORDER BY org_id, party LOOP
      PERFORM fn_hybrid_participant(NEW.chain_id, participant.org_id, participant.capability);
      SELECT * INTO a FROM shipment_plan_acceptance
        WHERE plan_id = NEW.plan_id AND revision = NEW.current_revision AND party = participant.party;
      IF NOT FOUND OR a.organization_id <> participant.org_id THEN RAISE EXCEPTION 'Missing current party acceptance'; END IF;
      SELECT account_status = 'ACTIVE' INTO user_active FROM app_user
        WHERE user_id = a.user_id AND organization_id = a.organization_id FOR SHARE;
      IF user_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Accepting user no longer active'; END IF;
      SELECT * INTO STRICT g FROM scoped_role_grant WHERE grant_id = a.grant_id FOR SHARE;
      IF g.user_id <> a.user_id OR g.organization_id <> a.organization_id OR g.revoked_at IS NOT NULL
        OR g.scope <> 'ORGANIZATION' OR g.role <> 'ORG_ADMIN' OR g.chain_id IS NOT NULL
        OR g.revision <> a.grant_revision THEN RAISE EXCEPTION 'Accepting grant no longer valid'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_plan_state BEFORE INSERT OR UPDATE OR DELETE ON shipment_plan
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_plan_state();

CREATE FUNCTION fn_hybrid_profile_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Business profile history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PREPARING' OR NEW.version <> 0 THEN RAISE EXCEPTION 'Profile starts in preparation'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.chain_id, NEW.scope_version, NEW.created_at) IS DISTINCT FROM ROW(OLD.chain_id, OLD.scope_version, OLD.created_at)
    OR NEW.version <> OLD.version + 1 OR NEW.state = OLD.state
    OR NEW.state = 'PREPARING' THEN RAISE EXCEPTION 'Invalid business profile transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_profile_state BEFORE INSERT OR UPDATE OR DELETE ON chain_business_profile
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_profile_state();

-- Farm ownership guard: current FARM capability replaces the single legacy type.
CREATE OR REPLACE FUNCTION public.fn_validate_farm_organization_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active boolean; cap_revoked timestamptz;
BEGIN
  SELECT status = 'ACTIVE' INTO active FROM organization
    WHERE organization_id = NEW.organization_id FOR SHARE;
  IF active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Farm organization must be ACTIVE'; END IF;
  SELECT revoked_at INTO cap_revoked FROM organization_capability
    WHERE organization_id = NEW.organization_id AND code = 'FARM' FOR SHARE;
  IF NOT FOUND OR cap_revoked IS NOT NULL THEN RAISE EXCEPTION 'Farm organization requires active FARM capability'; END IF;
  RETURN NEW;
END;
$$;

-- Every Shipment belongs to a chain: participants need membership/capability.
-- Quantity, state and unit protections are unchanged; no split Lots.
CREATE OR REPLACE FUNCTION public.fn_validate_shipment_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l lot%ROWTYPE; root_chain uuid; participant record;
BEGIN
  SELECT * INTO l FROM lot WHERE lot_id = NEW.lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot % does not exist', NEW.lot_id; END IF;
  IF l.current_state <> 'HARVESTED' THEN
    RAISE EXCEPTION 'Shipment can only be created for HARVESTED Lot. Current state: %', l.current_state;
  END IF;
  IF NEW.shipped_quantity <> l.available_quantity THEN
    RAISE EXCEPTION 'Core does not support split lot: shipped_quantity (%) must equal available_quantity (%)', NEW.shipped_quantity, l.available_quantity;
  END IF;
  IF NEW.unit <> l.unit THEN RAISE EXCEPTION 'Shipment unit (%) must match Lot unit (%)', NEW.unit, l.unit; END IF;
  IF NEW.status <> 'CREATED' THEN RAISE EXCEPTION 'New Shipment must start at CREATED state'; END IF;
  SELECT c.chain_id INTO STRICT root_chain FROM harvest_event h JOIN production_cycle c USING (cycle_id)
    WHERE h.harvest_id = l.harvest_id;
  FOR participant IN SELECT * FROM (VALUES
    (l.farm_org_id, 'FARM'::organization_type),
    (NEW.transporter_org_id, 'TRANSPORTER'::organization_type),
    (NEW.retailer_org_id, 'RETAILER'::organization_type)
  ) AS parties(org_id, capability) ORDER BY org_id, capability LOOP
    PERFORM fn_hybrid_participant(root_chain, participant.org_id, participant.capability);
  END LOOP;
  RETURN NEW;
END;
$$;

-- Ledger routes: definitions and per-event routes are immutable.
CREATE TRIGGER trg_ledger_route_definition_immutable BEFORE UPDATE OR DELETE ON ledger_route_definition
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_event_ledger_route_immutable BEFORE UPDATE OR DELETE ON event_ledger_route
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

-- Events created before this migration have no route; record them so the
-- "new events require a route" guard never applies to history.
CREATE TABLE ledger_route_exemption (
  event_id uuid PRIMARY KEY REFERENCES trace_event (event_id) ON UPDATE NO ACTION ON DELETE RESTRICT
);
INSERT INTO ledger_route_exemption (event_id) SELECT event_id FROM legacy_event;
CREATE FUNCTION fn_hybrid_route_exemption_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Legacy route exemptions are sealed'; END;
$$;
CREATE TRIGGER trg_hybrid_route_exemption_sealed BEFORE INSERT OR UPDATE OR DELETE ON ledger_route_exemption
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_route_exemption_sealed();

CREATE FUNCTION fn_hybrid_event_route_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e trace_event%ROWTYPE; d ledger_route_definition%ROWTYPE; p ledger_route_definition%ROWTYPE;
  predecessor uuid; legacy_proof blockchain_proof%ROWTYPE;
BEGIN
  SELECT * INTO STRICT e FROM trace_event WHERE event_id = NEW.event_id;
  SELECT * INTO STRICT d FROM ledger_route_definition WHERE digest = NEW.definition_digest;
  IF d.mode <> 'WRITE' OR EXISTS (SELECT 1 FROM ledger_route_exemption WHERE event_id = e.event_id) THEN
    RAISE EXCEPTION 'Only new events receive a WRITE route';
  END IF;
  IF e.previous_event_hash IS NOT NULL THEN
    IF (SELECT count(*) FROM trace_event t WHERE t.entity_type = e.entity_type
        AND t.entity_id = e.entity_id AND t.data_hash = e.previous_event_hash) <> 1 THEN
      RAISE EXCEPTION 'Ledger predecessor is unresolved or ambiguous';
    END IF;
    SELECT t.event_id INTO predecessor FROM trace_event t WHERE t.entity_type = e.entity_type
      AND t.entity_id = e.entity_id AND t.data_hash = e.previous_event_hash;
    SELECT rd.* INTO p FROM event_ledger_route er JOIN ledger_route_definition rd ON rd.digest = er.definition_digest
      WHERE er.event_id = predecessor;
    IF FOUND THEN
      IF (p.network, p.channel_id, p.chaincode_name, p.contract_name) IS DISTINCT FROM
        (d.network, d.channel_id, d.chaincode_name, d.contract_name) THEN
        RAISE EXCEPTION 'Ledger predecessor route differs';
      END IF;
    ELSE
      -- Legacy predecessor: its committed proof, if any, fixes the destination.
      SELECT * INTO legacy_proof FROM blockchain_proof WHERE event_id = predecessor;
      IF FOUND AND legacy_proof.transaction_status = 'CONFIRMED'
        AND (legacy_proof.network, legacy_proof.channel_id) IS DISTINCT FROM (d.network, d.channel_id) THEN
        RAISE EXCEPTION 'Legacy predecessor was committed to another ledger';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_event_route_insert BEFORE INSERT ON event_ledger_route
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_event_route_insert();

CREATE FUNCTION fn_hybrid_new_event_requires_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM event_ledger_route WHERE event_id = NEW.event_id) THEN
    RAISE EXCEPTION 'New trace event requires an immutable ledger route';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM event_chain_context WHERE event_id = NEW.event_id)
    AND coalesce(NEW.cycle_id, NEW.lot_id) IS NOT NULL THEN
    RAISE EXCEPTION 'New trace event requires a chain context';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_hybrid_new_event_requires_route AFTER INSERT ON trace_event
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_hybrid_new_event_requires_route();

CREATE FUNCTION fn_hybrid_proof_matches_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d ledger_route_definition%ROWTYPE; h varchar(64);
BEGIN
  SELECT rd.* INTO d FROM event_ledger_route er
    JOIN ledger_route_definition rd ON rd.digest = er.definition_digest WHERE er.event_id = NEW.event_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM ledger_route_exemption WHERE event_id = NEW.event_id) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Proof requires the event ledger route';
  END IF;
  SELECT data_hash INTO h FROM trace_event WHERE event_id = NEW.event_id;
  IF (NEW.network, NEW.channel_id, NEW.data_hash) IS DISTINCT FROM (d.network, d.channel_id, h) THEN
    RAISE EXCEPTION 'Proof destination/hash differs from immutable route';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_proof_matches_route BEFORE INSERT OR UPDATE ON blockchain_proof
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_proof_matches_route();

COMMIT;
