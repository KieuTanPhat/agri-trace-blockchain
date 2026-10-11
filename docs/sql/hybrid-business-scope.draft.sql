-- HYB-02/03/04 candidate. ISOLATED DATABASE ONLY; not a deployable migration.
-- The capability/authorization/core/Web and legacy cutover gates are separate.
BEGIN;

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
  IF NEW.chain_id IS NULL AND EXISTS (SELECT 1 FROM organization_business_scope WHERE organization_id = NEW.farm_org_id) THEN
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

-- Still a draft: dedicated DB scenarios, Prisma, service locking/read/write,
-- capability changes to existing Farm/Shipment triggers, cutover and Web gates
-- must pass before promotion. No CD allowlist/checksum exception exists here.
COMMIT;
