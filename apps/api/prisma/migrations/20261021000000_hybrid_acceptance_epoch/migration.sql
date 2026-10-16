BEGIN;

-- G01: a consent is bound to the exact chain membership epoch and party
-- capability revision current when it was accepted. Revoke/suspend + rejoin
-- or capability revoke + regrant under the same ORG_ADMIN grant must not
-- revive an old consent. Rows accepted before this migration keep NULL
-- snapshots (acceptance history is immutable) and can never finalize; the
-- plan needs a new revision and fresh consent from every party.
ALTER TABLE shipment_plan_acceptance
  ADD COLUMN membership_id uuid REFERENCES chain_membership ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD COLUMN membership_version integer CHECK (membership_version >= 0),
  ADD COLUMN capability_revision integer CHECK (capability_revision >= 0),
  ADD CONSTRAINT shipment_plan_acceptance_snapshot_complete CHECK (
    (membership_id IS NULL) = (membership_version IS NULL)
    AND (membership_id IS NULL) = (capability_revision IS NULL));

CREATE OR REPLACE FUNCTION fn_hybrid_acceptance_scope() RETURNS trigger LANGUAGE plpgsql AS $$
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
  -- fn_hybrid_participant has share-locked the membership and capability.
  IF NEW.membership_id IS NULL OR NEW.membership_version IS NULL OR NEW.capability_revision IS NULL
    OR NOT EXISTS (SELECT 1 FROM chain_membership
      WHERE membership_id = NEW.membership_id AND chain_id = p.chain_id
        AND organization_id = NEW.organization_id AND version = NEW.membership_version AND status = 'ACTIVE')
    OR NOT EXISTS (SELECT 1 FROM organization_capability
      WHERE organization_id = NEW.organization_id AND revision = NEW.capability_revision AND revoked_at IS NULL
        AND code = CASE NEW.party WHEN 'PRODUCER' THEN 'FARM'::organization_type
          WHEN 'TRANSPORTER' THEN 'TRANSPORTER'::organization_type ELSE 'RETAILER'::organization_type END) THEN
    RAISE EXCEPTION 'Acceptance requires the current membership and capability snapshot';
  END IF;
  NEW.accepted_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_hybrid_plan_state() RETURNS trigger LANGUAGE plpgsql AS $$
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
      -- A NULL snapshot is legacy consent: it never finalizes (new revision).
      IF a.membership_id IS NULL OR NOT EXISTS (SELECT 1 FROM chain_membership
          WHERE membership_id = a.membership_id AND chain_id = NEW.chain_id
            AND organization_id = a.organization_id AND version = a.membership_version AND status = 'ACTIVE')
        OR NOT EXISTS (SELECT 1 FROM organization_capability
          WHERE organization_id = a.organization_id AND code = participant.capability
            AND revision = a.capability_revision AND revoked_at IS NULL) THEN
        RAISE EXCEPTION 'Accepting membership or capability changed';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
