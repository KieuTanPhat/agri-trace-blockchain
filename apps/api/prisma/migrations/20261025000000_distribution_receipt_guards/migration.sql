CREATE FUNCTION guard_distribution_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Signing key history is immutable'; END IF;
 IF ROW(NEW.id,NEW.organization_id,NEW.public_key,NEW.label,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.public_key,OLD.label,OLD.created_at)
 OR OLD.status<>'ACTIVE' OR NEW.status<>'REVOKED' THEN RAISE EXCEPTION 'Only active key revocation is allowed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_key_guard BEFORE UPDATE OR DELETE ON distribution_key FOR EACH ROW EXECUTE FUNCTION guard_distribution_key();
CREATE FUNCTION guard_distribution_receipt_party() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t distribution_transfer%ROWTYPE;
BEGIN
 SELECT * INTO t FROM distribution_transfer WHERE id=NEW.transfer_id FOR UPDATE;
 IF (NEW.phase='CONSENT' AND NEW.organization_id NOT IN(t.sender_id,t.carrier_id,t.receiver_id))
 OR (NEW.phase='PICKUP' AND NEW.organization_id NOT IN(t.sender_id,t.carrier_id))
 OR (NEW.phase='DELIVERY' AND NEW.organization_id NOT IN(t.carrier_id,t.receiver_id))
 THEN RAISE EXCEPTION 'Wrong organization for handover phase'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_receipt_party BEFORE INSERT ON distribution_attestation FOR EACH ROW EXECUTE FUNCTION guard_distribution_receipt_party();
CREATE FUNCTION guard_distribution_receipt_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase_name text; required_count integer; actual_count integer;
BEGIN
 IF NEW.status=OLD.status OR NEW.status='CANCELLED' THEN RETURN NULL; END IF;
 phase_name:=CASE NEW.status WHEN 'READY' THEN 'CONSENT' WHEN 'IN_TRANSIT' THEN 'PICKUP' WHEN 'DELIVERED' THEN 'DELIVERY' END;
 required_count:=CASE phase_name WHEN 'CONSENT' THEN 3 ELSE 2 END;
 SELECT count(*) INTO actual_count FROM distribution_attestation WHERE transfer_id=NEW.id AND phase=phase_name;
 IF actual_count<>required_count THEN RAISE EXCEPTION 'Matching handover receipts are required before custody transfer'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER distribution_receipt_transition AFTER UPDATE ON distribution_transfer DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_distribution_receipt_transition();
CREATE FUNCTION guard_trace_supporting_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='trace_notice' THEN
   IF NOT EXISTS(SELECT 1 FROM trace_event e WHERE e.lot_id=NEW.lot_id AND e.entity_type='LOT' AND e.event_type='DISTRIBUTION_NOTICE'
     AND e.actor_organization_id=NEW.organization_id AND e.business_data->>'noticeId'=NEW.id::text
     AND e.business_data->>'kind'=NEW.kind AND e.business_data->>'message'=NEW.message)
   THEN RAISE EXCEPTION 'Public notice must match its immutable trace event'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM distribution_line l WHERE l.transfer_id=NEW.transfer_id AND NOT EXISTS(
     SELECT 1 FROM trace_event e WHERE e.lot_id=l.lot_id AND e.event_type='DISTRIBUTION_OBSERVED' AND e.actor_organization_id=NEW.organization_id
       AND e.business_data->>'observationId'=NEW.id::text AND e.business_data->>'note'=NEW.note))
   THEN RAISE EXCEPTION 'Journal entry must match every source lot trace event'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER notice_trace_guard AFTER INSERT ON trace_notice DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_trace_supporting_record();
CREATE CONSTRAINT TRIGGER observation_trace_guard AFTER INSERT ON distribution_observation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_trace_supporting_record();
