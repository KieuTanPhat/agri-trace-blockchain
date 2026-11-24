-- Arrival of a moving transfer at the receiver site. Set once, either by the
-- vehicle GPS entering the arrival radius of the receiver site or by the
-- carrying party confirming it. The receiver records the actual receipt and
-- the delivery phase is signed only after arrival.
CREATE TABLE distribution_arrival (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES distribution_transfer(id) ON DELETE RESTRICT,
  source varchar(10) NOT NULL CHECK (source IN ('GPS', 'MANUAL')),
  organization_id uuid,
  user_id uuid,
  device_id uuid,
  reason varchar(500),
  latitude numeric(9,6),
  longitude numeric(9,6),
  arrived_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT distribution_arrival_source_fields CHECK (
    (source = 'GPS' AND device_id IS NOT NULL AND latitude IS NOT NULL AND user_id IS NULL AND reason IS NULL)
    OR (source = 'MANUAL' AND organization_id IS NOT NULL AND user_id IS NOT NULL AND device_id IS NULL)),
  CONSTRAINT distribution_arrival_point CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE UNIQUE INDEX ux_distribution_arrival_transfer ON distribution_arrival(transfer_id);

CREATE FUNCTION fn_distribution_arrival_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Distribution arrival is append-only'; END IF;
  SELECT status, in_transit_at, carrier_id INTO t FROM distribution_transfer WHERE id = NEW.transfer_id FOR SHARE;
  IF t.status IS DISTINCT FROM 'IN_TRANSIT' OR t.in_transit_at IS NULL OR NEW.arrived_at < t.in_transit_at THEN
    RAISE EXCEPTION 'Arrival is recorded only while the transfer is in transit';
  END IF;
  IF NEW.source = 'MANUAL' AND NEW.organization_id IS DISTINCT FROM t.carrier_id THEN
    RAISE EXCEPTION 'Only the carrying party confirms arrival';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_distribution_arrival_guard BEFORE INSERT OR UPDATE OR DELETE ON distribution_arrival
  FOR EACH ROW EXECUTE FUNCTION fn_distribution_arrival_guard();

-- A confirmed arrival is a carrier claim: it is traced like a transport journal entry.
CREATE FUNCTION fn_distribution_arrival_trace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'MANUAL' AND NOT EXISTS (
    SELECT 1 FROM trace_event e
    WHERE e.entity_type = 'LOT' AND e.event_type = 'DISTRIBUTION_OBSERVED'
      AND e.actor_organization_id = NEW.organization_id
      AND e.business_data->>'arrivalId' = NEW.id::text)
  THEN RAISE EXCEPTION 'A confirmed arrival requires its trace event'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_distribution_arrival_trace AFTER INSERT ON distribution_arrival
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_distribution_arrival_trace();

-- The actual receipt and the delivery signatures follow the arrival.
CREATE FUNCTION fn_distribution_receipt_requires_arrival() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM distribution_arrival a WHERE a.transfer_id = NEW.transfer_id) THEN
    RAISE EXCEPTION 'The transfer has not arrived at the receiver site';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_distribution_receipt_requires_arrival BEFORE INSERT ON distribution_receipt
  FOR EACH ROW EXECUTE FUNCTION fn_distribution_receipt_requires_arrival();
CREATE FUNCTION fn_distribution_delivery_requires_arrival() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phase = 'DELIVERY' AND NOT EXISTS (SELECT 1 FROM distribution_arrival a WHERE a.transfer_id = NEW.transfer_id) THEN
    RAISE EXCEPTION 'The transfer has not arrived at the receiver site';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_distribution_delivery_requires_arrival BEFORE INSERT ON distribution_attestation
  FOR EACH ROW EXECUTE FUNCTION fn_distribution_delivery_requires_arrival();
