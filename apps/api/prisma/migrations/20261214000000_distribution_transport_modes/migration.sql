-- Transport modes for distribution transfers. The carrier role may now be held
-- by the sender (self delivery, or an external carrier hired by the sender) or
-- by the receiver (pickup, or an external carrier hired by the receiver).
-- Existing transfers keep PLATFORM_CARRIER and their three distinct parties.
ALTER TABLE distribution_transfer
  ADD COLUMN transport_mode varchar(30) NOT NULL DEFAULT 'PLATFORM_CARRIER',
  ADD COLUMN transport_details jsonb;

ALTER TABLE distribution_transfer DROP CONSTRAINT distribution_transfer_check;
ALTER TABLE distribution_transfer ADD CONSTRAINT distribution_transfer_parties CHECK (
  sender_id <> receiver_id AND (
    (transport_mode = 'PLATFORM_CARRIER' AND carrier_id <> sender_id AND carrier_id <> receiver_id AND transport_details IS NULL)
    OR (transport_mode = 'SELF_DELIVERY' AND carrier_id = sender_id AND vehicle_id IS NULL)
    OR (transport_mode = 'RECEIVER_PICKUP' AND carrier_id = receiver_id AND vehicle_id IS NULL)
    OR (transport_mode = 'EXTERNAL_CARRIER' AND carrier_id IN (sender_id, receiver_id) AND vehicle_id IS NULL
        AND transport_details ? 'carrierName' AND length(transport_details->>'carrierName') BETWEEN 2 AND 255)
  )
);

-- Distinct organizations that must sign one handover phase.
CREATE FUNCTION distribution_phase_parties(t distribution_transfer, phase text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT count(DISTINCT x) FROM unnest(CASE phase
    WHEN 'CONSENT' THEN ARRAY[t.sender_id, t.carrier_id, t.receiver_id]
    WHEN 'PICKUP' THEN ARRAY[t.sender_id, t.carrier_id]
    ELSE ARRAY[t.carrier_id, t.receiver_id] END) AS x
$$;

CREATE OR REPLACE FUNCTION guard_distribution_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Distribution history is append-only'; END IF;
 IF (NEW.id,NEW.chain_id,NEW.sender_id,NEW.carrier_id,NEW.receiver_id,NEW.origin,NEW.destination,NEW.vehicle_id,NEW.created_at,NEW.handover_mode,NEW.transport_mode,NEW.transport_details) IS DISTINCT FROM (OLD.id,OLD.chain_id,OLD.sender_id,OLD.carrier_id,OLD.receiver_id,OLD.origin,OLD.destination,OLD.vehicle_id,OLD.created_at,OLD.handover_mode,OLD.transport_mode,OLD.transport_details)
 THEN RAISE EXCEPTION 'Transfer snapshot and handover mode are immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR NOT ((OLD.status='PROPOSED' AND NEW.status IN ('PROPOSED','READY','CANCELLED')) OR (OLD.status='READY' AND NEW.status IN ('READY','IN_TRANSIT','CANCELLED')) OR (OLD.status='IN_TRANSIT' AND NEW.status IN ('IN_TRANSIT','DELIVERED')))
 OR NEW.attestation_epoch NOT IN(OLD.attestation_epoch,OLD.attestation_epoch+1)
 OR (NEW.attestation_epoch<>OLD.attestation_epoch AND (NEW.status<>OLD.status OR NEW.receipt_digest IS DISTINCT FROM OLD.receipt_digest))
 THEN RAISE EXCEPTION 'Invalid transfer transition or consent renewal'; END IF;
 IF NEW.receipt_digest IS DISTINCT FROM OLD.receipt_digest AND (OLD.receipt_digest IS NOT NULL OR NOT EXISTS(SELECT 1 FROM distribution_receipt WHERE transfer_id=NEW.id AND digest=NEW.receipt_digest)) THEN RAISE EXCEPTION 'Actual receipt digest must match its immutable record'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_distribution_receipt_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase_name text; actual_count integer;
BEGIN
 IF NEW.status=OLD.status OR NEW.status='CANCELLED' THEN RETURN NULL; END IF;
 phase_name:=CASE NEW.status WHEN 'READY' THEN 'CONSENT' WHEN 'IN_TRANSIT' THEN 'PICKUP' WHEN 'DELIVERED' THEN 'DELIVERY' END;
 SELECT count(*) INTO actual_count FROM distribution_attestation WHERE transfer_id=NEW.id AND phase=phase_name AND epoch=NEW.attestation_epoch;
 IF actual_count<>distribution_phase_parties(NEW,phase_name) THEN RAISE EXCEPTION 'Matching current-epoch handover receipts required'; END IF;
 IF NEW.attestation_epoch>0 AND (SELECT count(*) FROM distribution_attestation WHERE transfer_id=NEW.id AND phase='CONSENT' AND epoch=NEW.attestation_epoch)<>distribution_phase_parties(NEW,'CONSENT') THEN RAISE EXCEPTION 'Renewed consent from all organizations required'; END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION guard_distribution_return() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t distribution_transfer%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Return history is immutable'; END IF;
 SELECT * INTO t FROM distribution_transfer WHERE id=OLD.transfer_id;
 IF (NEW.id,NEW.transfer_id,NEW.lines,NEW.reason,NEW.digest,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.transfer_id,OLD.lines,OLD.reason,OLD.digest,OLD.created_at)
 OR OLD.status<>'PROPOSED' OR NEW.status<>'RETURNED' OR NEW.version<>OLD.version+1
 OR (SELECT count(*) FROM distribution_return_signature WHERE return_id=NEW.id)<>distribution_phase_parties(t,'PICKUP')
 THEN RAISE EXCEPTION 'Return requires matching independent signatures'; END IF;
 RETURN NEW;
END $$;

-- Receiver-initiated pickup requests. The sender turns one into a transfer
-- from its own stock; the request never reserves stock by itself.
CREATE TABLE distribution_pickup_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES organization(organization_id),
  receiver_id uuid NOT NULL REFERENCES organization(organization_id),
  requested_by uuid NOT NULL REFERENCES app_user(user_id),
  preferred_pickup_at timestamptz(6),
  note varchar(1000) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  transfer_id uuid UNIQUE REFERENCES distribution_transfer(id),
  resolution_note varchar(1000),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (sender_id <> receiver_id),
  CHECK (status IN ('OPEN','ACCEPTED','DECLINED','CANCELLED')),
  CHECK ((status = 'ACCEPTED') = (transfer_id IS NOT NULL))
);
CREATE INDEX distribution_pickup_sender_status ON distribution_pickup_request(sender_id, status);
CREATE INDEX distribution_pickup_receiver_status ON distribution_pickup_request(receiver_id, status);
CREATE FUNCTION guard_distribution_pickup_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Pickup request history is immutable'; END IF;
 IF (NEW.id,NEW.sender_id,NEW.receiver_id,NEW.requested_by,NEW.preferred_pickup_at,NEW.note,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.sender_id,OLD.receiver_id,OLD.requested_by,OLD.preferred_pickup_at,OLD.note,OLD.created_at)
 OR OLD.status<>'OPEN' OR NEW.status='OPEN' OR NEW.version<>OLD.version+1
 THEN RAISE EXCEPTION 'Pickup request can only be resolved once'; END IF;
 IF NEW.status='ACCEPTED' AND NOT EXISTS(SELECT 1 FROM distribution_transfer t WHERE t.id=NEW.transfer_id AND t.sender_id=NEW.sender_id AND t.receiver_id=NEW.receiver_id AND t.transport_mode='RECEIVER_PICKUP')
 THEN RAISE EXCEPTION 'Accepted pickup request must link its own pickup transfer'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_pickup_request_guard BEFORE UPDATE OR DELETE ON distribution_pickup_request FOR EACH ROW EXECUTE FUNCTION guard_distribution_pickup_request();
