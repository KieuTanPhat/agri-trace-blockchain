ALTER TYPE signing_operation ADD VALUE 'DISTRIBUTION_ATTEST';
ALTER TABLE distribution_transfer ADD COLUMN handover_mode handover_mode NOT NULL DEFAULT 'STANDARD', ADD COLUMN attestation_epoch integer NOT NULL DEFAULT 0 CHECK(attestation_epoch>=0);
ALTER TABLE distribution_attestation ADD COLUMN epoch integer NOT NULL DEFAULT 0 CHECK(epoch>=0);
ALTER TABLE distribution_attestation DROP CONSTRAINT distribution_attestation_transfer_id_organization_id_phase_key;
ALTER TABLE distribution_attestation ADD CONSTRAINT distribution_attestation_epoch_key UNIQUE(transfer_id,organization_id,phase,epoch);
ALTER TABLE distribution_attestation DROP CONSTRAINT distribution_attestation_key_ref_organization_id_fkey;
ALTER TABLE distribution_return_signature DROP CONSTRAINT distribution_return_signature_key_ref_organization_id_fkey;
CREATE TABLE distribution_signed_intent (
 document_id uuid NOT NULL, document_type varchar(20) NOT NULL CHECK(document_type IN ('TRANSFER','RETURN')),
 transfer_id uuid NOT NULL REFERENCES distribution_transfer(id), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 phase varchar(20) NOT NULL CHECK(phase IN ('CONSENT','PICKUP','DELIVERY','RETURN')), epoch integer NOT NULL,
 lot_id uuid NOT NULL REFERENCES lot(lot_id), intent_id uuid NOT NULL UNIQUE REFERENCES signing_intent(intent_id),
 PRIMARY KEY(document_id,organization_id,phase,epoch,lot_id)
);
CREATE TRIGGER distribution_intent_immutable BEFORE UPDATE OR DELETE ON distribution_signed_intent FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE OR REPLACE FUNCTION guard_distribution_receipt_party() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t distribution_transfer%ROWTYPE;
BEGIN
 SELECT * INTO t FROM distribution_transfer WHERE id=NEW.transfer_id FOR UPDATE;
 IF NEW.epoch<>t.attestation_epoch OR (NEW.phase='CONSENT' AND NEW.organization_id NOT IN(t.sender_id,t.carrier_id,t.receiver_id))
 OR (NEW.phase='PICKUP' AND NEW.organization_id NOT IN(t.sender_id,t.carrier_id))
 OR (NEW.phase='DELIVERY' AND NEW.organization_id NOT IN(t.carrier_id,t.receiver_id)) THEN RAISE EXCEPTION 'Wrong party or consent epoch'; END IF;
 IF t.handover_mode='STANDARD' THEN
  IF NOT EXISTS(SELECT 1 FROM distribution_key WHERE id=NEW.key_ref AND organization_id=NEW.organization_id AND status='ACTIVE') THEN RAISE EXCEPTION 'Active distribution key required'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM signing_key WHERE key_ref=NEW.key_ref AND organization_id=NEW.organization_id AND chain_id=t.chain_id AND status='ACTIVE') THEN RAISE EXCEPTION 'Active ledger signing key required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_distribution_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Distribution history is append-only'; END IF;
 IF (NEW.id,NEW.chain_id,NEW.sender_id,NEW.carrier_id,NEW.receiver_id,NEW.origin,NEW.destination,NEW.vehicle_id,NEW.created_at,NEW.handover_mode) IS DISTINCT FROM (OLD.id,OLD.chain_id,OLD.sender_id,OLD.carrier_id,OLD.receiver_id,OLD.origin,OLD.destination,OLD.vehicle_id,OLD.created_at,OLD.handover_mode)
 THEN RAISE EXCEPTION 'Transfer snapshot and handover mode are immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR NOT ((OLD.status='PROPOSED' AND NEW.status IN ('PROPOSED','READY','CANCELLED')) OR (OLD.status='READY' AND NEW.status IN ('READY','IN_TRANSIT','CANCELLED')) OR (OLD.status='IN_TRANSIT' AND NEW.status IN ('IN_TRANSIT','DELIVERED')))
 OR NEW.attestation_epoch NOT IN(OLD.attestation_epoch,OLD.attestation_epoch+1)
 OR (NEW.attestation_epoch<>OLD.attestation_epoch AND (NEW.status<>OLD.status OR NEW.receipt_digest IS DISTINCT FROM OLD.receipt_digest))
 THEN RAISE EXCEPTION 'Invalid transfer transition or consent renewal'; END IF;
 IF NEW.receipt_digest IS DISTINCT FROM OLD.receipt_digest AND (OLD.receipt_digest IS NOT NULL OR NOT EXISTS(SELECT 1 FROM distribution_receipt WHERE transfer_id=NEW.id AND digest=NEW.receipt_digest)) THEN RAISE EXCEPTION 'Actual receipt digest must match its immutable record'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_distribution_receipt_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase_name text; required_count integer; actual_count integer;
BEGIN
 IF NEW.status=OLD.status OR NEW.status='CANCELLED' THEN RETURN NULL; END IF;
 phase_name:=CASE NEW.status WHEN 'READY' THEN 'CONSENT' WHEN 'IN_TRANSIT' THEN 'PICKUP' WHEN 'DELIVERED' THEN 'DELIVERY' END;
 required_count:=CASE phase_name WHEN 'CONSENT' THEN 3 ELSE 2 END;
 SELECT count(*) INTO actual_count FROM distribution_attestation WHERE transfer_id=NEW.id AND phase=phase_name AND epoch=NEW.attestation_epoch;
 IF actual_count<>required_count THEN RAISE EXCEPTION 'Matching current-epoch handover receipts required'; END IF;
 IF NEW.attestation_epoch>0 AND (SELECT count(*) FROM distribution_attestation WHERE transfer_id=NEW.id AND phase='CONSENT' AND epoch=NEW.attestation_epoch)<>3 THEN RAISE EXCEPTION 'Renewed consent from all organizations required'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION guard_distribution_c2_attestation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t distribution_transfer%ROWTYPE; lid uuid;
BEGIN
 SELECT * INTO t FROM distribution_transfer WHERE id=NEW.transfer_id;
 IF t.handover_mode<>'DUAL_SIGNED' THEN RETURN NULL; END IF;
 FOR lid IN SELECT lot_id FROM distribution_line WHERE transfer_id=t.id LOOP
  IF NOT EXISTS(SELECT 1 FROM distribution_signed_intent d JOIN signing_intent i ON i.intent_id=d.intent_id JOIN event_actor_signature s ON s.intent_id=i.intent_id
    WHERE d.document_id=t.id AND d.document_type='TRANSFER' AND d.organization_id=NEW.organization_id AND d.phase=NEW.phase AND d.epoch=NEW.epoch AND d.lot_id=lid
    AND i.status='CONSUMED' AND i.operation::text='DISTRIBUTION_ATTEST' AND i.entity_type='LOT' AND i.entity_id=lid AND i.created_by=NEW.user_id AND i.key_ref=NEW.key_ref AND i.chain_id=t.chain_id)
  THEN RAISE EXCEPTION 'Each source lot requires its own consumed c2 intent and signed trace event'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER distribution_c2_attestation_guard AFTER INSERT ON distribution_attestation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_distribution_c2_attestation();
CREATE FUNCTION guard_distribution_return_party() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t distribution_transfer%ROWTYPE;
BEGIN
 SELECT t0.* INTO t FROM distribution_return r JOIN distribution_transfer t0 ON t0.id=r.transfer_id WHERE r.id=NEW.return_id FOR UPDATE OF t0;
 IF NEW.organization_id NOT IN(t.sender_id,t.carrier_id) THEN RAISE EXCEPTION 'Only carrier and original sender can hand back goods'; END IF;
 IF t.handover_mode='STANDARD' AND NOT EXISTS(SELECT 1 FROM distribution_key WHERE id=NEW.key_ref AND organization_id=NEW.organization_id AND status='ACTIVE') THEN RAISE EXCEPTION 'Active return key required'; END IF;
 IF t.handover_mode='DUAL_SIGNED' AND NOT EXISTS(SELECT 1 FROM signing_key WHERE key_ref=NEW.key_ref AND organization_id=NEW.organization_id AND chain_id=t.chain_id AND status='ACTIVE') THEN RAISE EXCEPTION 'Active ledger return key required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_return_party_guard BEFORE INSERT ON distribution_return_signature FOR EACH ROW EXECUTE FUNCTION guard_distribution_return_party();
CREATE FUNCTION guard_return_c2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r distribution_return%ROWTYPE; t distribution_transfer%ROWTYPE; line jsonb;
BEGIN
 SELECT * INTO r FROM distribution_return WHERE id=NEW.return_id;
 SELECT * INTO t FROM distribution_transfer WHERE id=r.transfer_id;
 IF t.handover_mode<>'DUAL_SIGNED' THEN RETURN NULL; END IF;
 FOR line IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
  IF NOT EXISTS(SELECT 1 FROM distribution_signed_intent d JOIN signing_intent i ON i.intent_id=d.intent_id JOIN event_actor_signature s ON s.intent_id=i.intent_id
   WHERE d.document_id=r.id AND d.document_type='RETURN' AND d.organization_id=NEW.organization_id AND d.phase='RETURN' AND d.lot_id=(line->>'lotId')::uuid
   AND i.status='CONSUMED' AND i.operation::text='DISTRIBUTION_ATTEST' AND i.created_by=NEW.user_id AND i.key_ref=NEW.key_ref AND i.chain_id=t.chain_id AND i.payload->>'documentId'=r.id::text)
  THEN RAISE EXCEPTION 'Return requires a consumed c2 intent for each source lot'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER distribution_return_c2_guard AFTER INSERT ON distribution_return_signature DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_return_c2();
CREATE FUNCTION guard_distribution_mode_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.handover_mode<>COALESCE((SELECT handover_mode FROM chain_ledger_profile WHERE chain_id=NEW.chain_id),'STANDARD'::handover_mode) THEN RAISE EXCEPTION 'Distribution must pin the current chain handover mode'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_mode_insert_guard BEFORE INSERT ON distribution_transfer FOR EACH ROW EXECUTE FUNCTION guard_distribution_mode_insert();
CREATE FUNCTION guard_distribution_mode_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.handover_mode IS DISTINCT FROM OLD.handover_mode AND (EXISTS(SELECT 1 FROM distribution_transfer WHERE chain_id=NEW.chain_id AND status IN ('PROPOSED','READY','IN_TRANSIT')) OR EXISTS(SELECT 1 FROM distribution_remainder r JOIN distribution_transfer t ON t.id=r.transfer_id WHERE t.chain_id=NEW.chain_id AND r.quantity>0)) THEN RAISE EXCEPTION 'Reconcile open distribution custody before changing signing mode'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_mode_change_guard BEFORE UPDATE ON chain_ledger_profile FOR EACH ROW EXECUTE FUNCTION guard_distribution_mode_change();
