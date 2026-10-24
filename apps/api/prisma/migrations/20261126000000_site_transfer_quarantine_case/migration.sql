-- Internal site-to-site transfer slips and quarantine slips (aaa.txt 1.2, 1.3).
-- Goods in an internal transfer stay in the organization's holding; they leave
-- the source site on dispatch and enter the destination only for the quantity
-- the destination confirms. Unconfirmed quantity waits for reconciliation.
CREATE TABLE site_transfer (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code varchar(40) NOT NULL UNIQUE,
 organization_id uuid NOT NULL REFERENCES organization(organization_id),
 lot_id uuid NOT NULL,
 from_site_id uuid NOT NULL,
 to_site_id uuid NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
 unit varchar(30) NOT NULL,
 received_quantity numeric(14,3),
 status varchar(20) NOT NULL DEFAULT 'PENDING'
   CHECK (status IN ('PENDING','IN_TRANSIT','RECEIVED','DISCREPANCY','CANCELLED')),
 resolution varchar(20) CHECK (resolution IN ('RETURNED','WRITTEN_OFF')),
 reason varchar(1000) NOT NULL,
 note varchar(1000),
 receiver_user_id uuid REFERENCES app_user(user_id),
 receipt_note varchar(1000),
 resolution_note varchar(1000),
 created_by uuid NOT NULL REFERENCES app_user(user_id),
 dispatched_by uuid REFERENCES app_user(user_id),
 received_by uuid REFERENCES app_user(user_id),
 resolved_by uuid REFERENCES app_user(user_id),
 cancelled_by uuid REFERENCES app_user(user_id),
 created_at timestamptz(6) NOT NULL DEFAULT now(),
 dispatched_at timestamptz(6),
 received_at timestamptz(6),
 resolved_at timestamptz(6),
 cancelled_at timestamptz(6),
 version integer NOT NULL DEFAULT 0,
 FOREIGN KEY (lot_id, organization_id) REFERENCES lot_holding(lot_id, organization_id),
 FOREIGN KEY (from_site_id, organization_id) REFERENCES enterprise_site(id, organization_id),
 FOREIGN KEY (to_site_id, organization_id) REFERENCES enterprise_site(id, organization_id),
 CHECK (from_site_id <> to_site_id),
 CHECK (received_quantity IS NULL OR (received_quantity >= 0 AND received_quantity <= quantity)),
 CHECK ((status IN ('RECEIVED','DISCREPANCY')) = (received_quantity IS NOT NULL)),
 CHECK (resolution IS NULL OR (status = 'RECEIVED' AND received_quantity < quantity))
);
CREATE INDEX site_transfer_org_lot ON site_transfer(organization_id, lot_id);
CREATE INDEX site_transfer_org_status ON site_transfer(organization_id, status);

CREATE OR REPLACE FUNCTION guard_site_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Site transfer history is immutable'; END IF;
 IF (NEW.id, NEW.code, NEW.organization_id, NEW.lot_id, NEW.from_site_id, NEW.to_site_id, NEW.quantity,
     NEW.unit, NEW.reason, NEW.note, NEW.receiver_user_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM
    (OLD.id, OLD.code, OLD.organization_id, OLD.lot_id, OLD.from_site_id, OLD.to_site_id, OLD.quantity,
     OLD.unit, OLD.reason, OLD.note, OLD.receiver_user_id, OLD.created_by, OLD.created_at)
 THEN RAISE EXCEPTION 'Site transfer content is immutable'; END IF;
 IF OLD.received_quantity IS NOT NULL AND NEW.received_quantity IS DISTINCT FROM OLD.received_quantity
 THEN RAISE EXCEPTION 'Confirmed receipt is immutable'; END IF;
 IF NEW.version <> OLD.version + 1 OR NOT (
      (OLD.status = 'PENDING' AND NEW.status IN ('IN_TRANSIT','CANCELLED'))
   OR (OLD.status = 'IN_TRANSIT' AND NEW.status IN ('RECEIVED','DISCREPANCY') AND NEW.resolution IS NULL)
   OR (OLD.status = 'DISCREPANCY' AND NEW.status = 'RECEIVED' AND NEW.resolution IS NOT NULL))
 THEN RAISE EXCEPTION 'Invalid site transfer transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER site_transfer_guard BEFORE UPDATE OR DELETE ON site_transfer FOR EACH ROW EXECUTE FUNCTION guard_site_transfer();

CREATE TABLE quarantine_case (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code varchar(40) NOT NULL UNIQUE,
 organization_id uuid NOT NULL REFERENCES organization(organization_id),
 lot_id uuid NOT NULL,
 site_id uuid NOT NULL,
 quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
 unit varchar(30) NOT NULL,
 cause varchar(30) NOT NULL CHECK (cause IN ('SUSPECTED_DAMAGE','QUALITY_FAILED','AWAITING_INSPECTION','OTHER')),
 reason varchar(1000) NOT NULL,
 note varchar(1000),
 released_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
 disposed_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (disposed_quantity >= 0),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','DISPOSED')),
 created_by uuid NOT NULL REFERENCES app_user(user_id),
 created_at timestamptz(6) NOT NULL DEFAULT now(),
 closed_at timestamptz(6),
 version integer NOT NULL DEFAULT 0,
 FOREIGN KEY (lot_id, organization_id, site_id) REFERENCES lot_site_holding(lot_id, organization_id, site_id),
 CHECK (released_quantity + disposed_quantity <= quantity),
 CHECK ((status = 'ACTIVE') = (released_quantity + disposed_quantity < quantity)),
 CHECK (status <> 'DISPOSED' OR disposed_quantity > 0),
 CHECK (status <> 'RELEASED' OR disposed_quantity = 0)
);
CREATE INDEX quarantine_case_org_lot ON quarantine_case(organization_id, lot_id, site_id);

CREATE OR REPLACE FUNCTION guard_quarantine_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Quarantine history is immutable'; END IF;
 IF (NEW.id, NEW.code, NEW.organization_id, NEW.lot_id, NEW.site_id, NEW.quantity, NEW.unit,
     NEW.cause, NEW.reason, NEW.note, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM
    (OLD.id, OLD.code, OLD.organization_id, OLD.lot_id, OLD.site_id, OLD.quantity, OLD.unit,
     OLD.cause, OLD.reason, OLD.note, OLD.created_by, OLD.created_at)
 THEN RAISE EXCEPTION 'Quarantine content is immutable'; END IF;
 IF OLD.status <> 'ACTIVE' OR NEW.version <> OLD.version + 1
    OR NEW.released_quantity < OLD.released_quantity OR NEW.disposed_quantity < OLD.disposed_quantity
 THEN RAISE EXCEPTION 'Invalid quarantine transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quarantine_case_guard BEFORE UPDATE OR DELETE ON quarantine_case FOR EACH ROW EXECUTE FUNCTION guard_quarantine_case();

-- Site stock plus internal goods in transit or awaiting reconciliation never
-- exceed the organization's holding; open quarantine slips never exceed the
-- quarantined quantity recorded at the site.
CREATE OR REPLACE FUNCTION assert_site_movement_balance_for(lid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE holder record; at_sites numeric; moving numeric;
BEGIN
 FOR holder IN SELECT organization_id, quantity FROM lot_holding WHERE lot_id = lid LOOP
   SELECT COALESCE(SUM(quantity), 0) INTO at_sites FROM lot_site_holding
     WHERE lot_id = lid AND organization_id = holder.organization_id;
   SELECT COALESCE(SUM(CASE WHEN status = 'IN_TRANSIT' THEN quantity
                            WHEN status = 'DISCREPANCY' THEN quantity - received_quantity END), 0)
     INTO moving FROM site_transfer
     WHERE lot_id = lid AND organization_id = holder.organization_id AND status IN ('IN_TRANSIT','DISCREPANCY');
   IF at_sites + moving > holder.quantity THEN
     RAISE EXCEPTION 'Site stock and internal transfers exceed organization balance';
   END IF;
 END LOOP;
 IF EXISTS (
   SELECT 1 FROM lot_site_holding s
   WHERE s.lot_id = lid AND s.quarantined < (
     SELECT COALESCE(SUM(q.quantity - q.released_quantity - q.disposed_quantity), 0)
     FROM quarantine_case q
     WHERE q.lot_id = s.lot_id AND q.organization_id = s.organization_id AND q.site_id = s.site_id AND q.status = 'ACTIVE'))
 THEN RAISE EXCEPTION 'Open quarantine slips exceed quarantined stock'; END IF;
END $$;
CREATE OR REPLACE FUNCTION assert_site_movement_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM assert_site_movement_balance_for(NEW.lot_id);
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER site_transfer_balance AFTER INSERT OR UPDATE ON site_transfer
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_site_movement_balance();
CREATE CONSTRAINT TRIGGER quarantine_case_balance AFTER INSERT OR UPDATE ON quarantine_case
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_site_movement_balance();
CREATE CONSTRAINT TRIGGER site_holding_movement_balance AFTER INSERT OR UPDATE ON lot_site_holding
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_site_movement_balance();
CREATE CONSTRAINT TRIGGER holding_movement_balance AFTER UPDATE ON lot_holding
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_site_movement_balance();

-- Evidence for the new slips.
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_entity_type_check;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_entity_type_check
  CHECK (entity_type IN ('PRODUCT','FARM','SITE','CYCLE','LOT','TRANSFER','MATERIAL','PROFILE','EXTERNAL_PARTNER','MEMBER','CHAIN','SITE_TRANSFER','QUARANTINE'));
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_kind_chk;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_kind_chk
  CHECK (kind IN ('OTHER','PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE','PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE','SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','LOT_DOCUMENT','SITE_IMAGE','BUSINESS_LICENSE','TRANSFER_IMAGE','HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO','MEMBER_AVATAR','MEMBER_DOCUMENT','CHAIN_IMAGE','QUARANTINE_IMAGE'));
