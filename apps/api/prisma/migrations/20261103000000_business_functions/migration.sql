-- Append-only business extension; historical events and migration bytes stay intact.
ALTER TABLE enterprise_site ADD COLUMN farm_id uuid UNIQUE REFERENCES farm(farm_id);
ALTER TABLE distribution_transfer ADD COLUMN receipt_digest varchar(64);
ALTER TABLE enterprise_enrollment ADD COLUMN service_activated_at timestamptz(6),
 ADD COLUMN service_activated_by uuid REFERENCES app_user(user_id), ADD COLUMN service_activation_reason varchar(1000),
 ADD CONSTRAINT enterprise_manual_activation CHECK ((service_activated_at IS NULL AND service_activated_by IS NULL AND service_activation_reason IS NULL) OR (service_activated_at IS NOT NULL AND service_activated_by IS NOT NULL AND length(btrim(service_activation_reason))>=10));
CREATE FUNCTION guard_enterprise_enrollment_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Enrollment history is immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR (NEW.id,NEW.organization_id,NEW.owner_id,NEW.registration_digest,NEW.business_id,NEW.hosting_mode) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.owner_id,OLD.registration_digest,OLD.business_id,OLD.hosting_mode)
 THEN RAISE EXCEPTION 'Enrollment identity or version mismatch'; END IF;
 IF OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED') AND NEW.service_activated_at IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='APPROVED' AND NEW.status='APPROVED' AND OLD.service_activated_at IS NULL AND NEW.service_activated_at IS NOT NULL THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Invalid enrollment transition';
END $$;
DROP TRIGGER trg_enterprise_enrollment_guard ON enterprise_enrollment;
CREATE TRIGGER trg_enterprise_enrollment_guard BEFORE UPDATE OR DELETE ON enterprise_enrollment FOR EACH ROW EXECUTE FUNCTION guard_enterprise_enrollment_v2();
CREATE OR REPLACE FUNCTION check_enterprise_paid_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM enterprise_enrollment e WHERE e.organization_id=NEW.organization_id AND e.activation_required AND (e.status<>'APPROVED' OR e.service_activated_at IS NULL))
  AND (EXISTS(SELECT 1 FROM organization_capability WHERE organization_id=NEW.organization_id AND revoked_at IS NULL) OR EXISTS(SELECT 1 FROM scoped_role_grant WHERE organization_id=NEW.organization_id AND revoked_at IS NULL))
 THEN RAISE EXCEPTION 'Business authority requires reviewed manual activation'; END IF;
 RETURN NULL;
END $$;
CREATE UNIQUE INDEX product_org_sku_normalized ON product(organization_id,lower(sku)) WHERE sku IS NOT NULL;
CREATE OR REPLACE FUNCTION guard_enterprise_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.permissions <@ ARRAY['profile.read','profile.manage','members.read','members.manage','roles.manage','partners.read','partners.manage','catalog.read','catalog.manage','sites.read','sites.manage','vehicles.read','vehicles.manage','production.read','production.write','distribution.read','distribution.write','distribution.sign','trace.read','qr.manage','reports.read','quantity.adjust','cases.read','cases.respond','inventory.manage','quarantine.manage','evidence.read','evidence.manage','materials.read','materials.manage']::text[]
 THEN RAISE EXCEPTION 'Unknown enterprise permission'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION guard_site_farm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.farm_id IS NOT NULL AND (NEW.kind<>'PRODUCTION' OR NOT EXISTS(SELECT 1 FROM farm WHERE farm_id=NEW.farm_id AND organization_id=NEW.organization_id))
 THEN RAISE EXCEPTION 'Production site must reference its own farm'; END IF;
 IF TG_OP='UPDATE' AND NEW.farm_id IS DISTINCT FROM OLD.farm_id THEN RAISE EXCEPTION 'Farm identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER site_farm_guard BEFORE INSERT OR UPDATE ON enterprise_site FOR EACH ROW EXECUTE FUNCTION guard_site_farm();
CREATE TABLE lot_site_holding (
 lot_id uuid NOT NULL, organization_id uuid NOT NULL, site_id uuid NOT NULL,
 quantity numeric(14,3) NOT NULL, reserved numeric(14,3) NOT NULL DEFAULT 0,
 quarantined numeric(14,3) NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 0,
 PRIMARY KEY(lot_id,organization_id,site_id),
 FOREIGN KEY(lot_id,organization_id) REFERENCES lot_holding(lot_id,organization_id),
 FOREIGN KEY(site_id,organization_id) REFERENCES enterprise_site(id,organization_id),
 CHECK(quantity>=0 AND reserved>=0 AND quarantined>=0 AND reserved+quarantined<=quantity)
);
CREATE TABLE distribution_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL UNIQUE REFERENCES distribution_transfer(id),
 organization_id uuid NOT NULL REFERENCES organization(organization_id), lines jsonb NOT NULL,
 reason varchar(1000) NOT NULL, digest varchar(64) NOT NULL,
 created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TRIGGER distribution_receipt_immutable BEFORE UPDATE OR DELETE ON distribution_receipt FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE TABLE distribution_remainder (
 transfer_id uuid NOT NULL, lot_id uuid NOT NULL, quantity numeric(14,3) NOT NULL CHECK(quantity>=0), version integer NOT NULL DEFAULT 0,
 PRIMARY KEY(transfer_id,lot_id), FOREIGN KEY(transfer_id,lot_id) REFERENCES distribution_line(transfer_id,lot_id)
);
CREATE TABLE distribution_return (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL REFERENCES distribution_transfer(id),
 lines jsonb NOT NULL, reason varchar(1000) NOT NULL, digest varchar(64) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','RETURNED')),
 version integer NOT NULL DEFAULT 0, created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX distribution_return_transfer ON distribution_return(transfer_id);
CREATE TABLE distribution_return_signature (
 return_id uuid NOT NULL REFERENCES distribution_return(id), organization_id uuid NOT NULL,
 user_id uuid NOT NULL, key_ref uuid NOT NULL, authority jsonb NOT NULL, signature varchar(86) NOT NULL,
 created_at timestamptz(6) NOT NULL DEFAULT now(), PRIMARY KEY(return_id,organization_id),
 FOREIGN KEY(user_id,organization_id) REFERENCES app_user(user_id,organization_id),
 FOREIGN KEY(key_ref,organization_id) REFERENCES distribution_key(id,organization_id)
);
CREATE TRIGGER distribution_return_signature_immutable BEFORE UPDATE OR DELETE ON distribution_return_signature FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE FUNCTION guard_actual_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t distribution_transfer%ROWTYPE; line record; row jsonb;
BEGIN
 SELECT * INTO t FROM distribution_transfer WHERE id=NEW.transfer_id FOR UPDATE;
 IF t.status<>'IN_TRANSIT' OR t.receiver_id<>NEW.organization_id OR EXISTS(SELECT 1 FROM distribution_attestation WHERE transfer_id=t.id AND phase='DELIVERY')
 THEN RAISE EXCEPTION 'Receipt requires receiver before delivery signing'; END IF;
 IF jsonb_array_length(NEW.lines)<>(SELECT count(*) FROM distribution_line WHERE transfer_id=t.id)
 THEN RAISE EXCEPTION 'Receipt must cover every line'; END IF;
 FOR line IN SELECT * FROM distribution_line WHERE transfer_id=t.id LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(NEW.lines) x WHERE x->>'lotId'=line.lot_id::text)<>1 THEN RAISE EXCEPTION 'Receipt line mismatch'; END IF;
   SELECT x INTO row FROM jsonb_array_elements(NEW.lines) x WHERE x->>'lotId'=line.lot_id::text;
   IF (row->>'received')::numeric<0 OR (row->>'rejected')::numeric<0 OR (row->>'quarantined')::numeric<0
    OR (row->>'received')::numeric+(row->>'rejected')::numeric>line.quantity OR (row->>'quarantined')::numeric>(row->>'received')::numeric
   THEN RAISE EXCEPTION 'Invalid receipt quantities'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER actual_receipt_guard BEFORE INSERT ON distribution_receipt FOR EACH ROW EXECUTE FUNCTION guard_actual_receipt();
CREATE FUNCTION guard_distribution_return() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Return history is immutable'; END IF;
 IF (NEW.id,NEW.transfer_id,NEW.lines,NEW.reason,NEW.digest,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.transfer_id,OLD.lines,OLD.reason,OLD.digest,OLD.created_at)
 OR OLD.status<>'PROPOSED' OR NEW.status<>'RETURNED' OR NEW.version<>OLD.version+1
 OR (SELECT count(*) FROM distribution_return_signature WHERE return_id=NEW.id)<>2
 THEN RAISE EXCEPTION 'Return requires matching independent signatures'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_return_guard BEFORE UPDATE OR DELETE ON distribution_return FOR EACH ROW EXECUTE FUNCTION guard_distribution_return();
CREATE OR REPLACE FUNCTION assert_distribution_balance_for(lid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE physical numeric; expected numeric; actor record; promised numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM lot_holding WHERE lot_id=lid) THEN RETURN; END IF;
 SELECT available_quantity INTO expected FROM lot WHERE lot_id=lid FOR UPDATE;
 SELECT COALESCE(SUM(quantity),0) INTO physical FROM lot_holding WHERE lot_id=lid;
 SELECT physical+COALESCE(SUM(l.quantity),0) INTO physical FROM distribution_line l JOIN distribution_transfer t ON t.id=l.transfer_id WHERE l.lot_id=lid AND t.status='IN_TRANSIT';
 SELECT physical+COALESCE(SUM(quantity),0) INTO physical FROM distribution_remainder WHERE lot_id=lid;
 IF physical<>expected THEN RAISE EXCEPTION 'Distribution quantity is not reconciled'; END IF;
 FOR actor IN SELECT organization_id,quantity,reserved FROM lot_holding WHERE lot_id=lid LOOP
   SELECT COALESCE(SUM(l.quantity),0) INTO promised FROM distribution_line l JOIN distribution_transfer t ON t.id=l.transfer_id WHERE l.lot_id=lid AND t.sender_id=actor.organization_id AND t.status IN ('PROPOSED','READY');
   IF actor.reserved<>promised THEN RAISE EXCEPTION 'Distribution reservation is not reconciled'; END IF;
   IF (SELECT COALESCE(SUM(quantity),0) FROM lot_site_holding WHERE lot_id=lid AND organization_id=actor.organization_id)>actor.quantity
    OR (SELECT COALESCE(SUM(reserved),0) FROM lot_site_holding WHERE lot_id=lid AND organization_id=actor.organization_id)>actor.reserved
   THEN RAISE EXCEPTION 'Site allocation exceeds organization balance'; END IF;
 END LOOP;
 FOR actor IN SELECT * FROM lot_site_holding WHERE lot_id=lid LOOP
   SELECT COALESCE(SUM(l.quantity),0) INTO promised FROM distribution_line l JOIN distribution_transfer t ON t.id=l.transfer_id WHERE l.lot_id=lid AND t.sender_id=actor.organization_id AND t.sender_site_id=actor.site_id AND t.status IN ('PROPOSED','READY');
   IF actor.reserved<>promised THEN RAISE EXCEPTION 'Site reservation is not reconciled'; END IF;
 END LOOP;
END $$;
CREATE CONSTRAINT TRIGGER site_holding_balance AFTER INSERT OR UPDATE ON lot_site_holding DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_distribution_balance();
CREATE CONSTRAINT TRIGGER remainder_balance AFTER INSERT OR UPDATE ON distribution_remainder DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_distribution_balance();
CREATE TABLE enterprise_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 entity_type varchar(30) NOT NULL, entity_id uuid NOT NULL, version integer NOT NULL,
 snapshot jsonb NOT NULL, reason varchar(1000) NOT NULL, actor_id uuid NOT NULL REFERENCES app_user(user_id),
 created_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(entity_type,entity_id,version)
);
CREATE INDEX enterprise_revision_org ON enterprise_revision(organization_id);
CREATE TRIGGER enterprise_revision_immutable BEFORE UPDATE OR DELETE ON enterprise_revision FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE TABLE trace_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 entity_type varchar(30) NOT NULL CHECK(entity_type IN ('PRODUCT','SITE','CYCLE','LOT','TRANSFER','MATERIAL')),
 entity_id uuid NOT NULL, chain_id uuid REFERENCES supply_chain(chain_id), site_id uuid REFERENCES enterprise_site(id),
 supersedes_id uuid REFERENCES trace_evidence(id), file_name varchar(180) NOT NULL,
 media_type varchar(40) NOT NULL CHECK(media_type IN ('image/png','image/jpeg','application/pdf')),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880), sha256 varchar(64) NOT NULL,
 content bytea NOT NULL, description varchar(1000) NOT NULL, public boolean NOT NULL DEFAULT false,
 actor_id uuid NOT NULL REFERENCES app_user(user_id), created_at timestamptz(6) NOT NULL DEFAULT now(),
 CHECK(octet_length(content)=size), CHECK(NOT public OR entity_type='LOT')
);
CREATE INDEX trace_evidence_subject ON trace_evidence(organization_id,entity_type,entity_id);
CREATE TRIGGER trace_evidence_immutable BEFORE UPDATE OR DELETE ON trace_evidence FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE TABLE production_material (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 code varchar(100) NOT NULL, name varchar(255) NOT NULL, kind varchar(30) NOT NULL CHECK(kind IN ('SEED','FERTILIZER','PROTECTION','OTHER')),
 supplier varchar(255), batch_code varchar(100), active_ingredient varchar(255), unit varchar(30) NOT NULL,
 withdrawal_days integer CHECK(withdrawal_days BETWEEN 0 AND 3650), expiry_date date,
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')), version integer NOT NULL DEFAULT 0,
 UNIQUE(organization_id,code)
);
