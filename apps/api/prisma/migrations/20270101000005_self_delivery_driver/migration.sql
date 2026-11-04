-- Self delivery names the driver: an employee of the sender holding the new
-- distribution.drive permission. That driver (or the owner) signs pickup and
-- delivery for the carrying side. Receiver pickup is retired with its requests.

-- Signed handovers cannot be rewritten, so refuse instead of deleting history.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM distribution_transfer WHERE transport_mode='RECEIVER_PICKUP') THEN
  RAISE EXCEPTION 'RECEIVER_PICKUP transfers exist; reconcile them before retiring receiver pickup';
 END IF;
END $$;

DROP TABLE distribution_pickup_request;
DROP FUNCTION guard_distribution_pickup_request();

ALTER TABLE distribution_transfer DROP CONSTRAINT distribution_transfer_parties;
ALTER TABLE distribution_transfer ADD CONSTRAINT distribution_transfer_parties CHECK (
  sender_id <> receiver_id AND (
    (transport_mode = 'PLATFORM_CARRIER' AND carrier_id <> sender_id AND carrier_id <> receiver_id AND transport_details IS NULL)
    OR (transport_mode = 'SELF_DELIVERY' AND carrier_id = sender_id)
    OR (transport_mode = 'EXTERNAL_CARRIER' AND carrier_id IN (sender_id, receiver_id) AND vehicle_id IS NULL
        AND transport_details ? 'carrierName' AND length(transport_details->>'carrierName') BETWEEN 2 AND 255)
  )
);

-- Existing self deliveries keep no driver and organization-level signing.
ALTER TABLE distribution_transfer
  ADD COLUMN driver_user_id uuid,
  ADD CONSTRAINT distribution_transfer_driver_member FOREIGN KEY (driver_user_id, sender_id)
    REFERENCES app_user (user_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT distribution_transfer_driver_mode CHECK (driver_user_id IS NULL OR transport_mode = 'SELF_DELIVERY');
CREATE INDEX distribution_transfer_driver ON distribution_transfer(driver_user_id) WHERE driver_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_distribution_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Distribution history is append-only'; END IF;
 IF (NEW.id,NEW.chain_id,NEW.sender_id,NEW.carrier_id,NEW.receiver_id,NEW.origin,NEW.destination,NEW.vehicle_id,NEW.created_at,NEW.handover_mode,NEW.transport_mode,NEW.transport_details,NEW.driver_user_id) IS DISTINCT FROM (OLD.id,OLD.chain_id,OLD.sender_id,OLD.carrier_id,OLD.receiver_id,OLD.origin,OLD.destination,OLD.vehicle_id,OLD.created_at,OLD.handover_mode,OLD.transport_mode,OLD.transport_details,OLD.driver_user_id)
 THEN RAISE EXCEPTION 'Transfer snapshot and handover mode are immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR NOT ((OLD.status='PROPOSED' AND NEW.status IN ('PROPOSED','READY','CANCELLED')) OR (OLD.status='READY' AND NEW.status IN ('READY','IN_TRANSIT','CANCELLED')) OR (OLD.status='IN_TRANSIT' AND NEW.status IN ('IN_TRANSIT','DELIVERED')))
 OR NEW.attestation_epoch NOT IN(OLD.attestation_epoch,OLD.attestation_epoch+1)
 OR (NEW.attestation_epoch<>OLD.attestation_epoch AND (NEW.status<>OLD.status OR NEW.receipt_digest IS DISTINCT FROM OLD.receipt_digest))
 THEN RAISE EXCEPTION 'Invalid transfer transition or consent renewal'; END IF;
 IF NEW.receipt_digest IS DISTINCT FROM OLD.receipt_digest AND (OLD.receipt_digest IS NOT NULL OR NOT EXISTS(SELECT 1 FROM distribution_receipt WHERE transfer_id=NEW.id AND digest=NEW.receipt_digest)) THEN RAISE EXCEPTION 'Actual receipt digest must match its immutable record'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_enterprise_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.permissions <@ ARRAY['profile.read','profile.manage','members.read','members.manage','roles.manage','partners.read','partners.manage','catalog.read','catalog.manage','sites.read','sites.manage','vehicles.read','vehicles.manage','production.read','production.write','distribution.read','distribution.write','distribution.sign','distribution.drive','trace.read','qr.manage','reports.read','quantity.adjust','cases.read','cases.respond','inventory.manage','quarantine.manage','evidence.read','evidence.manage','materials.read','materials.manage','processing.read','processing.write','devices.read','devices.manage']::text[]
 THEN RAISE EXCEPTION 'Unknown enterprise permission'; END IF;
 RETURN NEW;
END $$;
