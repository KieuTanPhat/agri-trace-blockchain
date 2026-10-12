-- Controlled HYB-06 candidate. ISOLATED DB ONLY, after business-scope draft.
-- No applied migration or CD checksum allowlist is changed.
BEGIN;
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
CREATE TABLE legacy_scope_mapping (
  cycle_id uuid PRIMARY KEY REFERENCES production_cycle ON DELETE RESTRICT ON UPDATE NO ACTION,
  manifest_id uuid NOT NULL REFERENCES legacy_scope_manifest ON DELETE RESTRICT ON UPDATE NO ACTION,
  chain_id uuid REFERENCES supply_chain ON DELETE RESTRICT ON UPDATE NO ACTION,
  checkpoint_digest varchar(64) NOT NULL CHECK (checkpoint_digest ~ '^[a-f0-9]{64}$'),
  actor_grants jsonb NOT NULL CHECK (jsonb_typeof(actor_grants)='array'),
  original_updated_at timestamptz(6) NOT NULL,
  applied_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX ix_legacy_scope_mapping_manifest ON legacy_scope_mapping(manifest_id);
CREATE TABLE legacy_command_bridge (
  command_commit_id uuid PRIMARY KEY REFERENCES command_commit ON DELETE RESTRICT ON UPDATE NO ACTION,
  manifest_id uuid NOT NULL REFERENCES legacy_scope_manifest ON DELETE RESTRICT ON UPDATE NO ACTION,
  cycle_id uuid NOT NULL REFERENCES legacy_scope_mapping ON DELETE RESTRICT ON UPDATE NO ACTION,
  protocol_version integer NOT NULL DEFAULT 1 CHECK (protocol_version=1),
  target_scope varchar(64) NOT NULL CHECK (target_scope ~ '^[a-f0-9]{64}$'),
  journal_digest varchar(64) NOT NULL CHECK (journal_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_legacy_manifest_immutable BEFORE UPDATE OR DELETE ON legacy_scope_manifest FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_legacy_consent_immutable BEFORE UPDATE OR DELETE ON legacy_scope_consent FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_legacy_mapping_immutable BEFORE UPDATE OR DELETE ON legacy_scope_mapping FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_legacy_bridge_immutable BEFORE UPDATE OR DELETE ON legacy_command_bridge FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

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
    PERFORM chain_id FROM chain_business_profile WHERE chain_id=chain FOR SHARE;
    PERFORM membership_id FROM chain_membership WHERE chain_id=chain AND organization_id=c.organization_id FOR SHARE;
    IF g.chain_id<>chain OR NOT EXISTS(SELECT 1 FROM supply_chain s JOIN chain_business_profile b USING(chain_id)
          JOIN chain_membership n USING(chain_id) WHERE s.chain_id=chain AND s.owner_organization_id=c.organization_id
          AND b.state='PREPARING' AND n.organization_id=c.organization_id AND n.status='ACTIVE') THEN RETURN false; END IF;
    RETURN true;
  END IF;
  SELECT value INTO p FROM jsonb_array_elements(m.plan->'proposals') WHERE value->>'key'=c.proposal_key;
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

CREATE FUNCTION fn_hybrid_legacy_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m legacy_scope_manifest%ROWTYPE; entry jsonb; c production_cycle%ROWTYPE; p jsonb; consent legacy_scope_consent%ROWTYPE;
BEGIN
  SELECT * INTO STRICT m FROM legacy_scope_manifest WHERE manifest_id=NEW.manifest_id;
  SELECT value INTO entry FROM jsonb_array_elements(m.document->'entries') WHERE value->>'cycleId'=NEW.cycle_id::text;
  SELECT * INTO STRICT c FROM production_cycle WHERE cycle_id=NEW.cycle_id FOR UPDATE;
  IF entry IS NULL OR c.chain_id IS NOT NULL OR (entry->>'producerOrgId')::uuid<>c.farm_org_id
    OR (entry->>'expectedVersion')::integer<>c.version OR c.updated_at<>NEW.original_updated_at
    OR NEW.chain_id IS DISTINCT FROM (entry->>'chainId')::uuid THEN RAISE EXCEPTION 'Legacy root provenance changed'; END IF;
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
CREATE TRIGGER trg_legacy_mapping_scope BEFORE INSERT ON legacy_scope_mapping FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_mapping();
CREATE FUNCTION fn_hybrid_legacy_mapping_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM production_cycle c WHERE c.cycle_id=NEW.cycle_id AND c.chain_id IS NOT DISTINCT FROM NEW.chain_id) THEN
    RAISE EXCEPTION 'Legacy mapping and root must commit together'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_legacy_mapping_complete AFTER INSERT ON legacy_scope_mapping DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_mapping_complete();

-- The original guard is retained for every ordinary mutation. Its one-time
-- mapping exception requires immutable provenance inserted in this transaction.
ALTER FUNCTION fn_hybrid_cycle_scope() RENAME TO fn_hybrid_cycle_scope_before_legacy;
CREATE FUNCTION fn_hybrid_cycle_scope() RETURNS trigger LANGUAGE plpgsql AS $$
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
DROP TRIGGER trg_hybrid_cycle_scope ON production_cycle;
CREATE TRIGGER trg_hybrid_cycle_scope BEFORE INSERT OR UPDATE ON production_cycle FOR EACH ROW EXECUTE FUNCTION fn_hybrid_cycle_scope();

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
DECLARE m legacy_scope_mapping%ROWTYPE; j command_commit%ROWTYPE;
BEGIN
  SELECT * INTO STRICT m FROM legacy_scope_mapping WHERE cycle_id=NEW.cycle_id;
  SELECT * INTO STRICT j FROM command_commit WHERE command_commit_id=NEW.command_commit_id;
  IF m.manifest_id<>NEW.manifest_id OR m.chain_id IS NULL OR NEW.target_scope=j.authorization_scope
    OR NOT EXISTS(SELECT 1 FROM chain_business_profile WHERE chain_id=m.chain_id AND state='ACTIVE')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.actor_grants) g WHERE g->>'userId'=j.requester_id)
    THEN RAISE EXCEPTION 'Legacy journal bridge lacks mapped current actor'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_legacy_bridge_scope BEFORE INSERT ON legacy_command_bridge FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_bridge();

CREATE FUNCTION fn_hybrid_legacy_activation_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m legacy_scope_manifest%ROWTYPE; entry jsonb;
BEGIN
  IF NEW.state<>'ACTIVE' OR OLD.state<>'PREPARING' THEN RETURN NEW; END IF;
  FOR m IN SELECT * FROM legacy_scope_manifest LOOP
    FOR entry IN SELECT value FROM jsonb_array_elements(m.document->'entries') LOOP
      IF entry->>'decision'='MAP' AND entry->>'chainId'=NEW.chain_id::text AND NOT EXISTS(
        SELECT 1 FROM legacy_scope_mapping WHERE manifest_id=m.manifest_id AND cycle_id=(entry->>'cycleId')::uuid AND chain_id=NEW.chain_id)
        THEN RAISE EXCEPTION 'Legacy mapping incomplete before activation'; END IF;
      IF entry->>'decision'='UNRESOLVED' AND EXISTS(SELECT 1 FROM jsonb_array_elements(m.inventory->'roots') r
        WHERE r->>'cycleId'=entry->>'cycleId' AND (r->>'active')::boolean) AND EXISTS(
          SELECT 1 FROM chain_membership WHERE chain_id=NEW.chain_id AND organization_id=(entry->>'producerOrgId')::uuid AND status='ACTIVE')
        THEN RAISE EXCEPTION 'Active unresolved legacy root blocks activation'; END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_legacy_activation_gate BEFORE UPDATE ON chain_business_profile FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_activation_gate();
COMMIT;
