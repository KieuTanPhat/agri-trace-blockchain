-- Hybrid A scope, immutable planning and controlled legacy cutover.
-- Required application schema floor; legacy images are not rollback compatible.
BEGIN;
-- Identity/scope revocation must remain distinguishable after reactivation.
-- Telemetry lastSeenAt updates do not create a new authorization epoch.
ALTER TABLE iot_device ADD COLUMN authority_revision integer NOT NULL DEFAULT 0 CHECK(authority_revision>=0);
CREATE FUNCTION fn_hybrid_device_authority_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.organization_id,NEW.cycle_id,NEW.device_code,NEW.status)
    IS DISTINCT FROM (OLD.organization_id,OLD.cycle_id,OLD.device_code,OLD.status) THEN
    NEW.authority_revision:=OLD.authority_revision+1;
  ELSIF NEW.authority_revision<>OLD.authority_revision THEN
    RAISE EXCEPTION 'Device authority revision is managed by identity transitions';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_device_authority_revision BEFORE UPDATE ON iot_device
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_device_authority_revision();

CREATE TYPE hybrid_business_profile_state AS ENUM ('PREPARING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE hybrid_stage AS ENUM ('PRODUCTION', 'TRANSPORT', 'RETAIL');
CREATE TYPE hybrid_assignment_state AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'CANCELLED');
CREATE TYPE hybrid_shipment_plan_state AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');
CREATE TYPE hybrid_plan_party AS ENUM ('PRODUCER', 'TRANSPORTER', 'RETAILER');

CREATE TABLE chain_business_profile (
  chain_id uuid PRIMARY KEY REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  state hybrid_business_profile_state NOT NULL DEFAULT 'PREPARING',
  scope_version integer NOT NULL DEFAULT 1 CHECK (scope_version = 1),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

-- Persist the cutover across membership revoke/profile suspension. A caller
-- cannot regain the legacy create path by omitting chainId after cutover.
CREATE TABLE organization_business_scope (
  organization_id uuid PRIMARY KEY REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  scope_version integer NOT NULL DEFAULT 1 CHECK (scope_version = 1),
  activated_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_hybrid_org_cutover_immutable BEFORE UPDATE OR DELETE ON organization_business_scope
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

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
  shipment_id uuid UNIQUE REFERENCES shipment ON UPDATE NO ACTION ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
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
  UNIQUE (plan_id, revision, party)
);

CREATE TABLE event_chain_context (
  event_id uuid PRIMARY KEY REFERENCES trace_event ON UPDATE NO ACTION ON DELETE RESTRICT,
  chain_id uuid NOT NULL REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  scope_version integer NOT NULL DEFAULT 1 CHECK (scope_version = 1),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

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
  IF TG_OP = 'UPDATE' AND NEW.chain_id IS DISTINCT FROM OLD.chain_id THEN
    RAISE EXCEPTION 'Cycle scope immutable; legacy mapping requires reviewed cutover';
  END IF;
  IF NEW.chain_id IS NULL AND (EXISTS (SELECT 1 FROM organization_business_scope WHERE organization_id = NEW.farm_org_id)
    OR EXISTS (SELECT 1 FROM harvest_event h JOIN lot l USING(harvest_id) JOIN shipment s USING(lot_id)
      JOIN organization_business_scope o ON o.organization_id IN(s.transporter_org_id,s.retailer_org_id) WHERE h.cycle_id=NEW.cycle_id)) THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Chain scope required after cutover'; END IF;
    RAISE EXCEPTION 'Unresolved legacy cycle blocks writes after cutover';
  END IF;
  IF NEW.chain_id IS NOT NULL THEN
    PERFORM fn_hybrid_participant(NEW.chain_id, NEW.farm_org_id, 'FARM');
  END IF;
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
      OR OLD.status <> 'PROPOSED' OR NEW.status NOT IN ('ACCEPTED','REJECTED','CANCELLED')
      OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Assignment subject/party immutable or transition invalid';
    END IF;
  ELSIF NEW.version <> 0 OR NEW.status NOT IN ('PROPOSED','ACCEPTED') THEN
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
  IF NEW.status IN ('PROPOSED','ACCEPTED') THEN
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

CREATE FUNCTION fn_hybrid_record_org_cutover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'chain_business_profile' THEN
    IF NEW.state = 'ACTIVE' THEN
      INSERT INTO organization_business_scope(organization_id)
        SELECT organization_id FROM chain_membership WHERE chain_id = NEW.chain_id AND status = 'ACTIVE'
        ON CONFLICT (organization_id) DO NOTHING;
    END IF;
  ELSIF TG_TABLE_NAME = 'chain_membership' THEN
    IF NEW.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM chain_business_profile WHERE chain_id = NEW.chain_id AND state = 'ACTIVE') THEN
      INSERT INTO organization_business_scope(organization_id) VALUES (NEW.organization_id)
        ON CONFLICT (organization_id) DO NOTHING;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected cutover trigger table';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_profile_cutover AFTER UPDATE ON chain_business_profile
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_record_org_cutover();
CREATE TRIGGER trg_hybrid_membership_cutover AFTER INSERT OR UPDATE ON chain_membership
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_record_org_cutover();

-- Keep the core Farm ownership guard, with current capability replacing the
-- single legacy type. Capability does not confer a user grant or chain access.
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

-- Scoped subjects use participant capability/membership/profile, while
-- unmapped legacy subjects retain the old type gate. Quantity, state and unit
-- protections are retained; changing capability never permits split Lots.
CREATE OR REPLACE FUNCTION public.fn_validate_shipment_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l lot%ROWTYPE; root_chain uuid; participant record; org_type organization_type; org_status organization_status;
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
  SELECT c.chain_id INTO root_chain FROM harvest_event h JOIN production_cycle c USING(cycle_id)
    WHERE h.harvest_id = l.harvest_id;
  IF root_chain IS NOT NULL THEN
    FOR participant IN SELECT * FROM (VALUES
      (l.farm_org_id,'FARM'::organization_type),
      (NEW.transporter_org_id,'TRANSPORTER'::organization_type),
      (NEW.retailer_org_id,'RETAILER'::organization_type)
    ) AS parties(org_id,capability) ORDER BY org_id,capability LOOP
      PERFORM fn_hybrid_participant(root_chain,participant.org_id,participant.capability);
    END LOOP;
  ELSE
    IF EXISTS (SELECT 1 FROM organization_business_scope WHERE organization_id IN
      (l.farm_org_id, NEW.transporter_org_id, NEW.retailer_org_id)) THEN
      RAISE EXCEPTION 'Unresolved legacy Shipment parties after cutover require reviewed chain mapping';
    END IF;
    SELECT type,status INTO org_type,org_status FROM organization WHERE organization_id = NEW.transporter_org_id FOR SHARE;
    IF NOT FOUND OR org_type <> 'TRANSPORTER' OR org_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'transporter_org_id must reference an ACTIVE TRANSPORTER organization';
    END IF;
    SELECT type,status INTO org_type,org_status FROM organization WHERE organization_id = NEW.retailer_org_id FOR SHARE;
    IF NOT FOUND OR org_type <> 'RETAILER' OR org_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'retailer_org_id must reference an ACTIVE RETAILER organization';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


CREATE TABLE legacy_scope_manifest (
  manifest_id uuid PRIMARY KEY,
  digest varchar(64) NOT NULL UNIQUE CHECK (digest ~ '^[a-f0-9]{64}$'),
  document jsonb NOT NULL,
  inventory jsonb NOT NULL,
  plan jsonb NOT NULL,
  review_keys jsonb NOT NULL CHECK (jsonb_typeof(review_keys)='object'),
  registered_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (document->>'id' = manifest_id::text),
  CHECK (document->>'operatorId' <> document->>'reviewerId'),
  CHECK (plan->>'manifestDigest' = digest AND plan->>'manifestId' = manifest_id::text)
);
CREATE TABLE legacy_scope_consent (
  consent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL REFERENCES legacy_scope_manifest ON DELETE RESTRICT ON UPDATE NO ACTION,
  proposal_key varchar(64) NOT NULL CHECK (proposal_key ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES scoped_role_grant ON DELETE RESTRICT ON UPDATE NO ACTION,
  grant_revision integer NOT NULL CHECK (grant_revision >= 0),
  accepted_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY(user_id,organization_id) REFERENCES app_user(user_id,organization_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT uq_legacy_scope_consent_proposal UNIQUE(manifest_id,proposal_key)
);
CREATE TABLE legacy_scope_checkpoint (
  cycle_id uuid NOT NULL REFERENCES production_cycle ON DELETE RESTRICT ON UPDATE NO ACTION,
  manifest_id uuid NOT NULL REFERENCES legacy_scope_manifest ON DELETE RESTRICT ON UPDATE NO ACTION,
  chain_id uuid REFERENCES supply_chain ON DELETE RESTRICT ON UPDATE NO ACTION,
  checkpoint_digest varchar(64) NOT NULL CHECK (checkpoint_digest ~ '^[a-f0-9]{64}$'),
  actor_grants jsonb NOT NULL CHECK (jsonb_typeof(actor_grants)='array'),
  original_updated_at timestamptz(6) NOT NULL,
  applied_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY(manifest_id,cycle_id)
);
CREATE TABLE legacy_scope_mapping (
  cycle_id uuid PRIMARY KEY REFERENCES production_cycle ON DELETE RESTRICT ON UPDATE NO ACTION,
  manifest_id uuid NOT NULL REFERENCES legacy_scope_manifest ON DELETE RESTRICT ON UPDATE NO ACTION,
  chain_id uuid NOT NULL REFERENCES supply_chain ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY(manifest_id,cycle_id) REFERENCES legacy_scope_checkpoint(manifest_id,cycle_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT uq_legacy_scope_mapping_checkpoint UNIQUE(manifest_id,cycle_id)
);
CREATE INDEX ix_legacy_scope_mapping_manifest ON legacy_scope_mapping(manifest_id);
CREATE TABLE legacy_scope_supersession (
  from_manifest_id uuid NOT NULL REFERENCES legacy_scope_manifest ON DELETE RESTRICT ON UPDATE NO ACTION,
  cycle_id uuid NOT NULL REFERENCES production_cycle ON DELETE RESTRICT ON UPDATE NO ACTION,
  to_manifest_id uuid NOT NULL REFERENCES legacy_scope_manifest ON DELETE RESTRICT ON UPDATE NO ACTION,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY(from_manifest_id,cycle_id),
  CHECK(from_manifest_id<>to_manifest_id)
);
CREATE TABLE legacy_command_bridge (
  command_commit_id uuid PRIMARY KEY REFERENCES command_commit ON DELETE RESTRICT ON UPDATE NO ACTION,
  manifest_id uuid NOT NULL REFERENCES legacy_scope_manifest ON DELETE RESTRICT ON UPDATE NO ACTION,
  cycle_id uuid NOT NULL REFERENCES legacy_scope_mapping ON DELETE RESTRICT ON UPDATE NO ACTION,
  protocol_version integer NOT NULL DEFAULT 1 CHECK (protocol_version IN(1,2)),
  target_scope varchar(64) NOT NULL CHECK (target_scope ~ '^[a-f0-9]{64}$'),
  journal_digest varchar(64) NOT NULL CHECK (journal_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_legacy_manifest_immutable BEFORE UPDATE OR DELETE ON legacy_scope_manifest FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_legacy_consent_immutable BEFORE UPDATE OR DELETE ON legacy_scope_consent FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_legacy_mapping_immutable BEFORE UPDATE OR DELETE ON legacy_scope_mapping FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_legacy_checkpoint_immutable BEFORE UPDATE OR DELETE ON legacy_scope_checkpoint FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_legacy_supersession_immutable BEFORE UPDATE OR DELETE ON legacy_scope_supersession FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_legacy_bridge_immutable BEFORE UPDATE OR DELETE ON legacy_command_bridge FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

CREATE FUNCTION fn_hybrid_legacy_supersession() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_manifest legacy_scope_manifest%ROWTYPE; new_manifest legacy_scope_manifest%ROWTYPE;
  from_entry jsonb; to_entry jsonb; old_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('chain-scope:legacy-scope-review',0));
  SELECT * INTO STRICT old_manifest FROM legacy_scope_manifest WHERE manifest_id=NEW.from_manifest_id;
  SELECT * INTO STRICT new_manifest FROM legacy_scope_manifest WHERE manifest_id=NEW.to_manifest_id;
  PERFORM cycle_id FROM production_cycle WHERE cycle_id=NEW.cycle_id FOR UPDATE;
  SELECT value INTO from_entry FROM jsonb_array_elements(old_manifest.document->'entries') WHERE value->>'cycleId'=NEW.cycle_id::text;
  SELECT value INTO to_entry FROM jsonb_array_elements(new_manifest.document->'entries') WHERE value->>'cycleId'=NEW.cycle_id::text;
  IF from_entry IS NULL OR to_entry IS NULL OR new_manifest.document->>'schema'<>'agritrace-legacy-scope-manifest-2'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(new_manifest.document->'supersedes') r WHERE r->>'manifestId'=NEW.from_manifest_id::text
      AND r->>'manifestDigest'=old_manifest.digest AND r->>'cycleId'=NEW.cycle_id::text)
    OR EXISTS(SELECT 1 FROM production_cycle WHERE cycle_id=NEW.cycle_id AND chain_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM legacy_scope_mapping WHERE cycle_id=NEW.cycle_id)
    OR (from_entry->>'decision'='MAP' AND (to_entry->>'decision'<>'MAP' OR to_entry->>'chainId' IS DISTINCT FROM from_entry->>'chainId'))
    THEN RAISE EXCEPTION 'Legacy supersession lacks reviewed unmapped same-target provenance'; END IF;
  IF EXISTS(WITH RECURSIVE successors(id) AS (
    SELECT NEW.to_manifest_id UNION SELECT s.to_manifest_id FROM legacy_scope_supersession s JOIN successors r ON s.from_manifest_id=r.id WHERE s.cycle_id=NEW.cycle_id)
    SELECT 1 FROM successors WHERE id=NEW.from_manifest_id) THEN RAISE EXCEPTION 'Legacy supersession cannot cycle'; END IF;
  -- PostgreSQL's built-in SHA-256 avoids an undeclared pgcrypto dependency.
  old_hash:=encode(sha256(convert_to('{"cycleId":"'||NEW.cycle_id::text||'","manifestId":"'||NEW.from_manifest_id::text||'"}','UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM idempotency_record r WHERE r.operation='SCOPE_APPLY_LEGACY_ROOT' AND r.request_hash=old_hash
    AND NOT EXISTS(SELECT 1 FROM command_commit j WHERE j.idempotency_record_id=r.idempotency_record_id)
    AND (r.status<>'FAILED' OR r.response_status IS NULL OR r.response_status<400))
    THEN RAISE EXCEPTION 'Uncertain old legacy apply blocks supersession'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_legacy_supersession_scope BEFORE INSERT ON legacy_scope_supersession FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_supersession();

CREATE FUNCTION fn_hybrid_legacy_consent_current(c legacy_scope_consent) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE m legacy_scope_manifest%ROWTYPE; p jsonb; g scoped_role_grant%ROWTYPE;
  chain uuid; cap organization_type; entry jsonb;
BEGIN
  SELECT * INTO STRICT m FROM legacy_scope_manifest WHERE manifest_id=c.manifest_id;
  PERFORM organization_id FROM organization WHERE organization_id=c.organization_id FOR SHARE;
  PERFORM user_id FROM app_user WHERE user_id=c.user_id FOR SHARE;
  SELECT * INTO STRICT g FROM scoped_role_grant WHERE grant_id=c.grant_id FOR SHARE;
  IF g.user_id<>c.user_id OR g.organization_id<>c.organization_id OR g.revoked_at IS NOT NULL OR g.revision<>c.grant_revision
    OR NOT EXISTS(SELECT 1 FROM app_user u JOIN organization o USING(organization_id) JOIN app_role r USING(role_id)
      WHERE u.user_id=c.user_id AND u.organization_id=c.organization_id AND u.account_status='ACTIVE' AND o.status='ACTIVE' AND r.code<>'SYSTEM_ADMIN') THEN RETURN false; END IF;
  IF m.review_keys ? c.proposal_key THEN
    IF c.user_id::text<>m.document->>'reviewerId' OR g.scope<>'CHAIN' OR g.role<>'CHAIN_MANAGER' THEN RETURN false; END IF;
    chain:=(m.review_keys->>c.proposal_key)::uuid;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.document->'entries') e WHERE e->>'chainId'=chain::text
      AND NOT EXISTS(SELECT 1 FROM legacy_scope_supersession s WHERE s.from_manifest_id=m.manifest_id AND s.cycle_id=(e->>'cycleId')::uuid)) THEN RETURN false; END IF;
    PERFORM chain_id FROM chain_business_profile WHERE chain_id=chain FOR SHARE;
    PERFORM membership_id FROM chain_membership WHERE chain_id=chain AND organization_id=c.organization_id FOR SHARE;
    IF g.chain_id<>chain OR NOT EXISTS(SELECT 1 FROM supply_chain s JOIN chain_business_profile b USING(chain_id)
          JOIN chain_membership n USING(chain_id) WHERE s.chain_id=chain AND s.owner_organization_id=c.organization_id
          AND b.state='PREPARING' AND n.organization_id=c.organization_id AND n.status='ACTIVE') THEN RETURN false; END IF;
    RETURN true;
  END IF;
  SELECT value INTO p FROM jsonb_array_elements(m.plan->'proposals') WHERE value->>'key'=c.proposal_key;
  IF EXISTS(SELECT 1 FROM legacy_scope_supersession WHERE from_manifest_id=m.manifest_id AND cycle_id=(p->>'cycleId')::uuid) THEN RETURN false; END IF;
  IF p IS NULL OR p->>'organizationId'<>c.organization_id::text OR g.scope<>'ORGANIZATION' OR g.chain_id IS NOT NULL OR g.role<>'ORG_ADMIN' THEN RETURN false; END IF;
  chain:=(p->>'chainId')::uuid;
  cap:=CASE p->>'stage' WHEN 'PRODUCTION' THEN 'FARM'::organization_type WHEN 'TRANSPORT' THEN 'TRANSPORTER'::organization_type ELSE 'RETAILER'::organization_type END;
  PERFORM chain_id FROM chain_business_profile WHERE chain_id=chain FOR SHARE;
  PERFORM membership_id FROM chain_membership WHERE chain_id=chain AND organization_id=c.organization_id FOR SHARE;
  PERFORM organization_id FROM organization_capability WHERE organization_id=c.organization_id AND code=cap FOR SHARE;
  RETURN EXISTS(SELECT 1 FROM chain_business_profile b JOIN chain_membership n USING(chain_id)
    JOIN organization_capability a ON a.organization_id=n.organization_id
    WHERE b.chain_id=chain AND b.state='PREPARING' AND n.organization_id=c.organization_id AND n.status='ACTIVE' AND a.code=cap AND a.revoked_at IS NULL);
END;
$$;
CREATE FUNCTION fn_hybrid_legacy_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT fn_hybrid_legacy_consent_current(NEW) THEN RAISE EXCEPTION 'Legacy consent lacks current party/review authority'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_legacy_consent_current BEFORE INSERT ON legacy_scope_consent FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_consent();

CREATE FUNCTION fn_hybrid_legacy_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m legacy_scope_manifest%ROWTYPE; entry jsonb; c production_cycle%ROWTYPE; p jsonb; consent legacy_scope_consent%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('chain-scope:legacy-scope-review',0));
  SELECT * INTO STRICT m FROM legacy_scope_manifest WHERE manifest_id=NEW.manifest_id;
  SELECT value INTO entry FROM jsonb_array_elements(m.document->'entries') WHERE value->>'cycleId'=NEW.cycle_id::text;
  SELECT * INTO STRICT c FROM production_cycle WHERE cycle_id=NEW.cycle_id FOR UPDATE;
  IF entry IS NULL OR c.chain_id IS NOT NULL OR (entry->>'producerOrgId')::uuid<>c.farm_org_id
    OR (entry->>'expectedVersion')::integer<>c.version OR c.updated_at<>NEW.original_updated_at
    OR NEW.chain_id IS DISTINCT FROM (entry->>'chainId')::uuid
    OR EXISTS(SELECT 1 FROM legacy_scope_supersession WHERE from_manifest_id=NEW.manifest_id AND cycle_id=NEW.cycle_id)
    THEN RAISE EXCEPTION 'Legacy root provenance changed'; END IF;
  IF NEW.chain_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM chain_business_profile WHERE chain_id=NEW.chain_id AND state='PREPARING') THEN RAISE EXCEPTION 'Legacy target must remain PREPARING'; END IF;
  SELECT * INTO consent FROM legacy_scope_consent WHERE manifest_id=m.manifest_id AND proposal_key IN (
    SELECT key FROM jsonb_each_text(m.review_keys) WHERE value=NEW.chain_id::text);
  IF NOT FOUND OR NOT fn_hybrid_legacy_consent_current(consent) THEN RAISE EXCEPTION 'Legacy owner review missing or stale'; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(m.plan->'proposals') WHERE value->>'cycleId'=c.cycle_id::text LOOP
    SELECT * INTO consent FROM legacy_scope_consent WHERE manifest_id=m.manifest_id AND proposal_key=p->>'key';
    IF NOT FOUND OR NOT fn_hybrid_legacy_consent_current(consent) THEN RAISE EXCEPTION 'Legacy participant consent missing or stale'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_legacy_checkpoint_scope BEFORE INSERT ON legacy_scope_checkpoint FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_checkpoint();
CREATE FUNCTION fn_hybrid_legacy_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM legacy_scope_checkpoint WHERE manifest_id=NEW.manifest_id AND cycle_id=NEW.cycle_id AND chain_id=NEW.chain_id)
    OR EXISTS(SELECT 1 FROM legacy_scope_supersession WHERE from_manifest_id=NEW.manifest_id AND cycle_id=NEW.cycle_id)
    THEN RAISE EXCEPTION 'Final legacy mapping requires a current MAP checkpoint'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_legacy_mapping_scope BEFORE INSERT ON legacy_scope_mapping FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_mapping();
CREATE FUNCTION fn_hybrid_legacy_mapping_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM production_cycle c WHERE c.cycle_id=NEW.cycle_id AND c.chain_id IS NOT DISTINCT FROM NEW.chain_id) THEN
    RAISE EXCEPTION 'Legacy mapping and root must commit together'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_legacy_mapping_complete AFTER INSERT ON legacy_scope_mapping DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_mapping_complete();
CREATE FUNCTION fn_hybrid_legacy_checkpoint_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.chain_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM legacy_scope_mapping m JOIN production_cycle c USING(cycle_id)
    WHERE m.cycle_id=NEW.cycle_id AND m.manifest_id=NEW.manifest_id AND m.chain_id=NEW.chain_id AND c.chain_id=NEW.chain_id)
    THEN RAISE EXCEPTION 'MAP checkpoint, final mapping and root must commit together'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_legacy_checkpoint_complete AFTER INSERT ON legacy_scope_checkpoint DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_checkpoint_complete();

-- The original guard is retained for every ordinary mutation. Its one-time
-- mapping exception requires immutable provenance inserted in this transaction.
CREATE OR REPLACE FUNCTION fn_hybrid_cycle_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.chain_id IS NULL AND NEW.chain_id IS NOT NULL AND
    (to_jsonb(NEW)-'chain_id')=(to_jsonb(OLD)-'chain_id') AND EXISTS(
      SELECT 1 FROM legacy_scope_mapping m JOIN chain_business_profile b USING(chain_id)
      WHERE m.cycle_id=NEW.cycle_id AND m.chain_id=NEW.chain_id AND b.state='PREPARING') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.chain_id IS DISTINCT FROM OLD.chain_id THEN RAISE EXCEPTION 'Cycle scope immutable; legacy mapping requires reviewed cutover'; END IF;
  IF NEW.chain_id IS NULL AND (EXISTS(SELECT 1 FROM organization_business_scope WHERE organization_id=NEW.farm_org_id)
    OR EXISTS(SELECT 1 FROM harvest_event h JOIN lot l USING(harvest_id) JOIN shipment s USING(lot_id)
      JOIN organization_business_scope o ON o.organization_id IN(s.transporter_org_id,s.retailer_org_id) WHERE h.cycle_id=NEW.cycle_id)) THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Chain scope required after cutover'; END IF;
    RAISE EXCEPTION 'Unresolved legacy cycle blocks writes after cutover'; END IF;
  IF NEW.chain_id IS NOT NULL THEN PERFORM fn_hybrid_participant(NEW.chain_id,NEW.farm_org_id,'FARM'); END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fn_hybrid_legacy_cycle_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.chain_id IS NULL AND NEW.chain_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM legacy_scope_mapping WHERE cycle_id=NEW.cycle_id AND chain_id=NEW.chain_id)
    AND (to_jsonb(NEW)-'chain_id'-'updated_at')=(to_jsonb(OLD)-'chain_id'-'updated_at') THEN NEW.updated_at:=OLD.updated_at; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_zz_hybrid_legacy_timestamp BEFORE UPDATE ON production_cycle FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_cycle_timestamp();

-- Only exact legacy subjects with valid consent may acquire assignments while
-- PREPARING. All existing ACTIVE assignment validation remains in place.
CREATE FUNCTION fn_hybrid_legacy_stage_participant(p_chain uuid,p_org uuid,p_cap organization_type) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM organization_id FROM organization WHERE organization_id=p_org FOR SHARE;
  PERFORM membership_id FROM chain_membership WHERE chain_id=p_chain AND organization_id=p_org FOR SHARE;
  PERFORM organization_id FROM organization_capability WHERE organization_id=p_org AND code=p_cap FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM organization o JOIN organization_capability a USING(organization_id)
    JOIN chain_membership n USING(organization_id) WHERE o.organization_id=p_org AND o.status='ACTIVE'
    AND a.code=p_cap AND a.revoked_at IS NULL AND n.chain_id=p_chain AND n.status='ACTIVE') THEN RAISE EXCEPTION 'Legacy participant unavailable'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION fn_hybrid_stage_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_chain uuid; subject_org uuid; capability organization_type;
  root_cycle uuid; mapping legacy_scope_mapping%ROWTYPE; proposal jsonb; consent legacy_scope_consent%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Assignment history cannot be deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.assignment_id,NEW.chain_id,NEW.organization_id,NEW.stage,NEW.cycle_id,NEW.lot_id,NEW.shipment_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.assignment_id,OLD.chain_id,OLD.organization_id,OLD.stage,OLD.cycle_id,OLD.lot_id,OLD.shipment_id,OLD.created_at)
      OR OLD.status<>'PROPOSED' OR NEW.status NOT IN('ACCEPTED','REJECTED','CANCELLED') OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'Assignment subject/party immutable or transition invalid'; END IF;
  ELSIF NEW.version<>0 OR NEW.status NOT IN('PROPOSED','ACCEPTED') THEN RAISE EXCEPTION 'Invalid initial assignment'; END IF;
  IF NEW.stage='PRODUCTION' THEN
    SELECT chain_id,farm_org_id,cycle_id INTO subject_chain,subject_org,root_cycle FROM production_cycle WHERE cycle_id=NEW.cycle_id;
    capability:='FARM';
  ELSIF NEW.stage='TRANSPORT' THEN
    SELECT c.chain_id,s.transporter_org_id,c.cycle_id INTO subject_chain,subject_org,root_cycle FROM shipment s
      JOIN lot l USING(lot_id) JOIN harvest_event h ON h.harvest_id=l.harvest_id JOIN production_cycle c USING(cycle_id)
      WHERE s.shipment_id=NEW.shipment_id;
    capability:='TRANSPORTER';
  ELSE
    SELECT c.chain_id,s.retailer_org_id,c.cycle_id INTO subject_chain,subject_org,root_cycle FROM lot l JOIN shipment s USING(lot_id)
      JOIN harvest_event h ON h.harvest_id=l.harvest_id JOIN production_cycle c USING(cycle_id) WHERE l.lot_id=NEW.lot_id;
    capability:='RETAILER';
  END IF;
  IF subject_chain IS DISTINCT FROM NEW.chain_id OR subject_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Assignment subject/chain/party mismatch'; END IF;
  IF NEW.status IN('PROPOSED','ACCEPTED') THEN
    IF EXISTS(SELECT 1 FROM chain_business_profile WHERE chain_id=NEW.chain_id AND state='PREPARING') THEN
      SELECT * INTO STRICT mapping FROM legacy_scope_mapping WHERE cycle_id=root_cycle AND chain_id=NEW.chain_id;
      SELECT p INTO proposal FROM legacy_scope_manifest m, jsonb_array_elements(m.plan->'proposals') p
        WHERE m.manifest_id=mapping.manifest_id AND p->>'cycleId'=root_cycle::text AND p->>'stage'=NEW.stage::text
        AND p->>'organizationId'=NEW.organization_id::text AND p->'subject'->>'id'=coalesce(NEW.cycle_id,NEW.lot_id,NEW.shipment_id)::text;
      IF proposal IS NULL THEN RAISE EXCEPTION 'Preparing assignment lacks a reviewed legacy proposal'; END IF;
      SELECT * INTO consent FROM legacy_scope_consent WHERE manifest_id=mapping.manifest_id AND proposal_key=proposal->>'key';
      IF NOT FOUND OR NOT fn_hybrid_legacy_consent_current(consent) THEN RAISE EXCEPTION 'Preparing assignment lacks current participant consent'; END IF;
      PERFORM fn_hybrid_legacy_stage_participant(NEW.chain_id,NEW.organization_id,capability);
    ELSE PERFORM fn_hybrid_participant(NEW.chain_id,NEW.organization_id,capability); END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fn_hybrid_legacy_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m legacy_scope_mapping%ROWTYPE; j command_commit%ROWTYPE; checkpoint legacy_scope_checkpoint%ROWTYPE;
BEGIN
  SELECT * INTO STRICT m FROM legacy_scope_mapping WHERE cycle_id=NEW.cycle_id;
  SELECT * INTO STRICT checkpoint FROM legacy_scope_checkpoint WHERE manifest_id=m.manifest_id AND cycle_id=m.cycle_id;
  SELECT * INTO STRICT j FROM command_commit WHERE command_commit_id=NEW.command_commit_id;
  IF m.manifest_id<>NEW.manifest_id OR m.chain_id IS NULL OR NEW.target_scope=j.authorization_scope
    OR NOT EXISTS(SELECT 1 FROM chain_business_profile WHERE chain_id=m.chain_id AND state='ACTIVE')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(checkpoint.actor_grants) g
      WHERE g->>'userId'=j.requester_id AND g->>'role'=j.actor_scope->>'role'
        AND ((NEW.protocol_version=1 AND g->>'role' IN('FARM_STAFF','TRANSPORTER','RETAILER'))
          OR (NEW.protocol_version=2 AND g->>'role' IN('COMPLIANCE_REVIEWER','IOT_DEVICE')))
        AND ((g->>'role'='IOT_DEVICE' AND EXISTS(SELECT 1 FROM iot_device d WHERE d.device_id::text=g->>'deviceId'
          AND d.organization_id::text=g->>'organizationId' AND d.status='ACTIVE'
          AND d.authority_revision=(g->>'authorityRevision')::integer
          AND ((g->>'bindingId' IS NULL AND d.cycle_id=m.cycle_id) OR EXISTS(
            SELECT 1 FROM shipment_tracking_binding b JOIN shipment s USING(shipment_id) JOIN lot l USING(lot_id) JOIN harvest_event h USING(harvest_id)
            WHERE b.binding_id::text=g->>'bindingId' AND b.device_id=d.device_id AND b.status='ACTIVE' AND b.unbound_at IS NULL
              AND h.cycle_id=m.cycle_id AND b.transporter_org_id=d.organization_id))))
          OR (g->>'role'<>'IOT_DEVICE' AND g->>'organizationId'=j.actor_scope->>'organizationId'
            AND EXISTS(SELECT 1 FROM scoped_role_grant r JOIN chain_membership n USING(chain_id,organization_id)
              JOIN app_user u ON u.user_id=r.user_id JOIN organization o ON o.organization_id=r.organization_id
              WHERE r.grant_id::text=g->>'grantId' AND r.revision=(g->>'grantRevision')::integer AND r.revoked_at IS NULL
                AND r.user_id::text=j.requester_id AND r.role::text=g->>'role' AND r.chain_id=m.chain_id
                AND u.account_status='ACTIVE' AND o.status='ACTIVE' AND n.status='ACTIVE')
            AND (g->>'role'<>'COMPLIANCE_REVIEWER' OR EXISTS(SELECT 1 FROM compliance_assignment a JOIN production_cycle c USING(farm_id)
              WHERE a.assignment_id::text=g->>'reviewerAssignmentId' AND a.reviewer_user_id::text=j.requester_id
                AND a.revoked_at IS NULL AND c.cycle_id=m.cycle_id AND c.farm_org_id::text<>g->>'organizationId')))))
    THEN RAISE EXCEPTION 'Legacy journal bridge lacks mapped current actor'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_legacy_bridge_scope BEFORE INSERT ON legacy_command_bridge FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_bridge();

-- Current readiness also covers roots absent from any registered manifest.
-- Match inventoryLegacyScope's conservative active definition, including Pending.
CREATE FUNCTION fn_hybrid_legacy_root_active(p_cycle uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM production_cycle c WHERE c.cycle_id=p_cycle AND (
    c.current_state NOT IN('COMPLETED','CANCELLED')
    OR EXISTS(SELECT 1 FROM harvest_event h JOIN lot l USING(harvest_id) WHERE h.cycle_id=c.cycle_id
      AND l.current_state NOT IN('SOLD','RECALLED','EXPIRED','DAMAGED'))
    OR EXISTS(SELECT 1 FROM harvest_event h JOIN lot l USING(harvest_id) JOIN shipment s USING(lot_id)
      WHERE h.cycle_id=c.cycle_id AND s.status<>'DELIVERED')
    OR EXISTS(SELECT 1 FROM trace_event e JOIN blockchain_outbox b USING(event_id) WHERE b.status<>'COMPLETED'
      AND (e.cycle_id=c.cycle_id OR e.lot_id IN(SELECT l.lot_id FROM harvest_event h JOIN lot l USING(harvest_id) WHERE h.cycle_id=c.cycle_id)))
  ))
$$;
CREATE FUNCTION fn_hybrid_legacy_activation_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m legacy_scope_manifest%ROWTYPE; entry jsonb;
BEGIN
  IF NEW.state<>'ACTIVE' OR OLD.state<>'PREPARING' THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM production_cycle c WHERE c.chain_id IS NULL AND fn_hybrid_legacy_root_active(c.cycle_id)
    AND EXISTS(SELECT 1 FROM chain_membership n WHERE n.chain_id=NEW.chain_id AND n.status='ACTIVE'
      AND (n.organization_id=c.farm_org_id OR EXISTS(SELECT 1 FROM harvest_event h JOIN lot l USING(harvest_id) JOIN shipment s USING(lot_id)
        WHERE h.cycle_id=c.cycle_id AND n.organization_id IN(s.transporter_org_id,s.retailer_org_id)))))
    THEN RAISE EXCEPTION 'Active unresolved legacy root blocks activation'; END IF;
  FOR m IN SELECT * FROM legacy_scope_manifest LOOP
    FOR entry IN SELECT value FROM jsonb_array_elements(m.document->'entries') LOOP
      IF EXISTS(SELECT 1 FROM legacy_scope_supersession WHERE from_manifest_id=m.manifest_id AND cycle_id=(entry->>'cycleId')::uuid) THEN CONTINUE; END IF;
      IF entry->>'decision'='MAP' AND entry->>'chainId'=NEW.chain_id::text AND NOT EXISTS(
        SELECT 1 FROM legacy_scope_mapping WHERE manifest_id=m.manifest_id AND cycle_id=(entry->>'cycleId')::uuid AND chain_id=NEW.chain_id)
        THEN RAISE EXCEPTION 'Legacy mapping incomplete before activation'; END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_legacy_activation_gate BEFORE UPDATE ON chain_business_profile FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_activation_gate();
COMMIT;
