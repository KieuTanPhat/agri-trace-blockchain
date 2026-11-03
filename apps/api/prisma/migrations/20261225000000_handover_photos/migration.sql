-- Handover photos. Pickup and delivery photos are fixed by a digest that the
-- transfer snapshot carries, so every signature of that phase covers them;
-- receipt photos enter the receipt digest; damage photos enter the trace event.
-- Additive only: no event, hash, proof or signature is changed.

ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_kind_chk;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_kind_chk CHECK (kind IN (
  'OTHER','PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE',
  'PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE',
  'SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','LOT_DOCUMENT','SITE_IMAGE',
  'BUSINESS_LICENSE','TRANSFER_IMAGE','HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO',
  'MEMBER_AVATAR','MEMBER_DOCUMENT','CHAIN_IMAGE','QUARANTINE_IMAGE',
  'PARTNERSHIP_EVIDENCE','RECEIPT_DOCUMENT','PROCESSING_IMAGE',
  'INVOICE','PURCHASE_LIST','WEIGHING_SLIP','LAB_TEST','PRODUCT_DECLARATION',
  'DAMAGE_IMAGE'));

ALTER TABLE distribution_transfer ADD COLUMN photos_digest varchar(64);
ALTER TABLE distribution_receipt ADD COLUMN photos jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE distribution_handover_photo (
  transfer_id uuid NOT NULL REFERENCES distribution_transfer(id),
  phase varchar(20) NOT NULL CHECK (phase IN ('PICKUP','DELIVERY')),
  evidence_id uuid NOT NULL UNIQUE REFERENCES trace_evidence(id),
  sha256 varchar(64) NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization(organization_id),
  created_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (transfer_id, evidence_id)
);
CREATE TRIGGER distribution_handover_photo_immutable BEFORE UPDATE OR DELETE ON distribution_handover_photo
  FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();

-- True once any organization has signed that phase, in either protocol.
CREATE FUNCTION distribution_phase_signed(transfer uuid, step text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM distribution_attestation WHERE transfer_id=transfer AND phase=step)
      OR EXISTS(SELECT 1 FROM distribution_signed_intent WHERE transfer_id=transfer AND document_type='TRANSFER' AND phase=step)
$$;

CREATE FUNCTION guard_handover_photo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t distribution_transfer%ROWTYPE;
BEGIN
 SELECT * INTO t FROM distribution_transfer WHERE id=NEW.transfer_id FOR UPDATE;
 IF NOT ((NEW.phase='PICKUP' AND t.status='READY' AND NEW.organization_id IN (t.sender_id,t.carrier_id))
      OR (NEW.phase='DELIVERY' AND t.status='IN_TRANSIT' AND NEW.organization_id IN (t.carrier_id,t.receiver_id)))
 THEN RAISE EXCEPTION 'Handover photo requires a party of the open phase'; END IF;
 IF distribution_phase_signed(t.id, NEW.phase) THEN RAISE EXCEPTION 'Handover photos are fixed once the phase is signed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM trace_evidence e WHERE e.id=NEW.evidence_id AND e.entity_type='TRANSFER' AND e.entity_id=t.id
   AND e.organization_id=NEW.organization_id AND e.kind='TRANSFER_IMAGE' AND e.sha256=NEW.sha256)
 THEN RAISE EXCEPTION 'Handover photo must be this party''s transfer image'; END IF;
 IF (SELECT count(*) FROM distribution_handover_photo WHERE transfer_id=t.id AND phase=NEW.phase)>=6
 THEN RAISE EXCEPTION 'At most six photos per handover phase'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_handover_photo_guard BEFORE INSERT ON distribution_handover_photo
  FOR EACH ROW EXECUTE FUNCTION guard_handover_photo();

-- The digest moves only with the status unchanged and the open phase unsigned.
CREATE FUNCTION guard_transfer_photos_digest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.photos_digest IS DISTINCT FROM OLD.photos_digest AND (
   NEW.photos_digest IS NULL OR NEW.status<>OLD.status OR OLD.status NOT IN ('READY','IN_TRANSIT')
   OR distribution_phase_signed(OLD.id, CASE OLD.status WHEN 'READY' THEN 'PICKUP' ELSE 'DELIVERY' END))
 THEN RAISE EXCEPTION 'Handover photo digest changes only before the open phase is signed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_transfer_photos_digest BEFORE UPDATE ON distribution_transfer
  FOR EACH ROW EXECUTE FUNCTION guard_transfer_photos_digest();

-- Receipt photos: the receiver's own transfer images; a shortfall, rejection
-- or quarantine needs at least one.
CREATE FUNCTION guard_receipt_photos() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE photo jsonb; discrepancy boolean;
BEGIN
 IF jsonb_typeof(NEW.photos)<>'array' OR jsonb_array_length(NEW.photos)>6 THEN RAISE EXCEPTION 'Receipt photos must be a list of at most six'; END IF;
 FOR photo IN SELECT * FROM jsonb_array_elements(NEW.photos) LOOP
   IF NOT EXISTS(SELECT 1 FROM trace_evidence e WHERE e.id::text=photo->>'evidenceId' AND e.entity_type='TRANSFER'
     AND e.entity_id=NEW.transfer_id AND e.organization_id=NEW.organization_id AND e.kind='TRANSFER_IMAGE' AND e.sha256=photo->>'sha256')
   THEN RAISE EXCEPTION 'Receipt photo must be the receiver''s transfer image'; END IF;
 END LOOP;
 SELECT bool_or((x->>'missing')::numeric>0 OR (x->>'rejected')::numeric>0 OR (x->>'quarantined')::numeric>0)
   INTO discrepancy FROM jsonb_array_elements(NEW.lines) x;
 IF discrepancy AND jsonb_array_length(NEW.photos)=0 THEN RAISE EXCEPTION 'A receipt discrepancy needs a photo'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_receipt_photos BEFORE INSERT ON distribution_receipt
  FOR EACH ROW EXECUTE FUNCTION guard_receipt_photos();
