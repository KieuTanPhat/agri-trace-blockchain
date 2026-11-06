-- ADR-006: per-device identity, devices bound to plots (field sensors) or
-- vehicles (GPS trackers), position tracking on distribution transfers and a
-- sealed route digest. Historical rows, events and hashes are not rewritten.

-- 1. Device identity and asset binding --------------------------------------
ALTER TABLE iot_device
  ADD COLUMN plot_id uuid REFERENCES plot(plot_id) ON DELETE RESTRICT,
  ADD COLUMN vehicle_id uuid REFERENCES enterprise_vehicle(id) ON DELETE RESTRICT,
  ADD COLUMN public_key varchar(64),
  ADD COLUMN simulated boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT ck_iot_device_single_asset CHECK (plot_id IS NULL OR vehicle_id IS NULL),
  ADD CONSTRAINT ck_iot_device_asset_without_cycle CHECK (
    (plot_id IS NULL AND vehicle_id IS NULL) OR cycle_id IS NULL),
  ADD CONSTRAINT ck_iot_device_public_key CHECK (
    public_key IS NULL OR public_key ~ '^[A-Za-z0-9_-]{59}$'),
  ADD CONSTRAINT ck_iot_device_asset_kind CHECK (
    (plot_id IS NULL OR type = 'FIELD_SENSOR') AND (vehicle_id IS NULL OR type = 'GPS_TRACKER'));

CREATE INDEX ix_iot_device_plot ON iot_device(plot_id) WHERE plot_id IS NOT NULL;
CREATE UNIQUE INDEX ux_iot_device_active_vehicle ON iot_device(vehicle_id)
  WHERE vehicle_id IS NOT NULL AND status = 'ACTIVE';

-- The bound asset must belong to the device organization.
CREATE FUNCTION fn_iot_device_asset_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plot_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM plot p JOIN farm f ON f.farm_id = p.farm_id
        WHERE p.plot_id = NEW.plot_id AND f.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'Plot does not belong to the device organization';
  END IF;
  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM enterprise_vehicle v
        WHERE v.id = NEW.vehicle_id AND v.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'Vehicle does not belong to the device organization';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_iot_device_asset_owner BEFORE INSERT OR UPDATE OF organization_id, plot_id, vehicle_id
  ON iot_device FOR EACH ROW EXECUTE FUNCTION fn_iot_device_asset_owner();

-- Identity transitions now include the asset binding and the public key.
CREATE OR REPLACE FUNCTION fn_hybrid_device_authority_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.organization_id, NEW.cycle_id, NEW.device_code, NEW.status, NEW.plot_id, NEW.vehicle_id, NEW.public_key)
    IS DISTINCT FROM (OLD.organization_id, OLD.cycle_id, OLD.device_code, OLD.status, OLD.plot_id, OLD.vehicle_id, OLD.public_key) THEN
    NEW.authority_revision := OLD.authority_revision + 1;
  ELSIF NEW.authority_revision <> OLD.authority_revision THEN
    RAISE EXCEPTION 'Device authority revision is managed by identity transitions';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Field sensor readings ----------------------------------------------------
ALTER TABLE sensor_reading ADD COLUMN device_sequence bigint CHECK (device_sequence IS NULL OR device_sequence >= 0);
-- One plot reading may be recorded for every running cycle on that plot.
CREATE UNIQUE INDEX ux_sensor_reading_device_sequence ON sensor_reading(device_id, device_sequence, cycle_id)
  WHERE device_sequence IS NOT NULL;

-- A reading belongs either to the cycle the legacy device is bound to, or to a
-- cycle of the same organization on the plot the device is bound to.
CREATE OR REPLACE FUNCTION public.fn_validate_sensor_reading_device_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_device RECORD;
BEGIN
    SELECT cycle_id, plot_id, organization_id
      INTO v_device
      FROM public.iot_device
     WHERE device_id = NEW.device_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'IoT device % does not exist', NEW.device_id;
    END IF;

    IF v_device.cycle_id IS NOT NULL AND v_device.cycle_id = NEW.cycle_id THEN
        RETURN NEW;
    END IF;

    IF v_device.plot_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.production_cycle c
          WHERE c.cycle_id = NEW.cycle_id
            AND c.plot_id = v_device.plot_id
            AND c.farm_org_id = v_device.organization_id) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'IoT device % is not bound to production cycle %',
        NEW.device_id,
        NEW.cycle_id;
END;
$$;

-- 3. Transfers: transit window, one vehicle per moving transfer ---------------
ALTER TABLE distribution_transfer
  ADD COLUMN in_transit_at timestamptz(6),
  ADD COLUMN delivered_at timestamptz(6),
  ADD CONSTRAINT ck_distribution_transit_window CHECK (
    delivered_at IS NULL OR (in_transit_at IS NOT NULL AND delivered_at >= in_transit_at));
-- Only transfers picked up from now on (in_transit_at set) are covered; earlier
-- simulated data may hold one vehicle on several moving transfers and is kept.
CREATE UNIQUE INDEX ux_distribution_vehicle_in_transit ON distribution_transfer(vehicle_id)
  WHERE vehicle_id IS NOT NULL AND status = 'IN_TRANSIT' AND in_transit_at IS NOT NULL;

-- The carrying party may name its own declared vehicle for self delivery and
-- pickup (GPS tracking). External carriers still have no AgriTrace vehicle.
ALTER TABLE distribution_transfer DROP CONSTRAINT distribution_transfer_parties;
ALTER TABLE distribution_transfer ADD CONSTRAINT distribution_transfer_parties CHECK (
  sender_id <> receiver_id AND (
    (transport_mode = 'PLATFORM_CARRIER' AND carrier_id <> sender_id AND carrier_id <> receiver_id AND transport_details IS NULL)
    OR (transport_mode = 'SELF_DELIVERY' AND carrier_id = sender_id)
    OR (transport_mode = 'RECEIVER_PICKUP' AND carrier_id = receiver_id)
    OR (transport_mode = 'EXTERNAL_CARRIER' AND carrier_id IN (sender_id, receiver_id) AND vehicle_id IS NULL
        AND transport_details ? 'carrierName' AND length(transport_details->>'carrierName') BETWEEN 2 AND 255)
  )
);
-- A named vehicle belongs to the carrying party.
CREATE FUNCTION fn_distribution_vehicle_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM enterprise_vehicle v WHERE v.id = NEW.vehicle_id AND v.organization_id = NEW.carrier_id) THEN
    RAISE EXCEPTION 'Transfer vehicle does not belong to the carrier';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_distribution_vehicle_owner BEFORE INSERT ON distribution_transfer
  FOR EACH ROW EXECUTE FUNCTION fn_distribution_vehicle_owner();
-- Transit instants are written once, together with their status transition.
CREATE FUNCTION fn_distribution_transit_window() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.in_transit_at IS NOT NULL OR NEW.delivered_at IS NOT NULL THEN
      RAISE EXCEPTION 'Transit instants are set by handover transitions';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.in_transit_at IS DISTINCT FROM OLD.in_transit_at
     AND NOT (OLD.in_transit_at IS NULL AND OLD.status = 'READY' AND NEW.status = 'IN_TRANSIT') THEN
    RAISE EXCEPTION 'in_transit_at is set once when pickup completes';
  END IF;
  IF NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
     AND NOT (OLD.delivered_at IS NULL AND OLD.status = 'IN_TRANSIT' AND NEW.status = 'DELIVERED') THEN
    RAISE EXCEPTION 'delivered_at is set once when delivery completes';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_distribution_transit_window BEFORE INSERT OR UPDATE ON distribution_transfer
  FOR EACH ROW EXECUTE FUNCTION fn_distribution_transit_window();

-- Transport records positions only; manual journals no longer carry temperature.
-- Already-issued DISTRIBUTION_OBSERVED events keep their original payload bytes.
ALTER TABLE distribution_observation DROP COLUMN temperature;

-- 4. Positions (append-only) --------------------------------------------------
CREATE TABLE distribution_position (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES distribution_transfer(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES iot_device(device_id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES enterprise_vehicle(id) ON DELETE RESTRICT,
  device_sequence bigint NOT NULL CHECK (device_sequence >= 0),
  recorded_at timestamptz(6) NOT NULL,
  received_at timestamptz(6) NOT NULL DEFAULT now(),
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m numeric(8,2) CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  speed_kmh numeric(6,2) CHECK (speed_kmh IS NULL OR speed_kmh >= 0),
  heading numeric(6,2) CHECK (heading IS NULL OR (heading >= 0 AND heading < 360)),
  satellites smallint CHECK (satellites IS NULL OR satellites BETWEEN 0 AND 64),
  battery numeric(5,2) CHECK (battery IS NULL OR battery BETWEEN 0 AND 100),
  validity varchar(20) NOT NULL CHECK (validity IN ('VALID', 'ANOMALY', 'LATE')),
  anomaly_code varchar(40),
  CONSTRAINT ck_distribution_position_anomaly CHECK ((validity = 'ANOMALY') = (anomaly_code IS NOT NULL)),
  CONSTRAINT ux_distribution_position_device_sequence UNIQUE (device_id, device_sequence)
);
CREATE INDEX ix_distribution_position_transfer_time ON distribution_position(transfer_id, recorded_at);

CREATE FUNCTION fn_distribution_position_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Distribution positions are append-only';
END $$;
CREATE TRIGGER trg_distribution_position_append_only BEFORE UPDATE OR DELETE ON distribution_position
  FOR EACH ROW EXECUTE FUNCTION fn_distribution_position_append_only();

-- A position belongs to the transfer moving on the device's vehicle and falls
-- inside its transit window. LATE rows arrive after the route was sealed.
CREATE FUNCTION fn_distribution_position_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t RECORD; d RECORD;
BEGIN
  SELECT vehicle_id, status, in_transit_at, delivered_at INTO t FROM distribution_transfer WHERE id = NEW.transfer_id;
  SELECT vehicle_id, type, organization_id INTO d FROM iot_device WHERE device_id = NEW.device_id;
  IF d.type <> 'GPS_TRACKER' OR d.vehicle_id IS DISTINCT FROM NEW.vehicle_id OR t.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    RAISE EXCEPTION 'Position device is not on the transfer vehicle';
  END IF;
  IF t.in_transit_at IS NULL OR NEW.recorded_at < t.in_transit_at
     OR (t.delivered_at IS NOT NULL AND NEW.recorded_at > t.delivered_at) THEN
    RAISE EXCEPTION 'Position is outside the transit window';
  END IF;
  IF t.status <> 'IN_TRANSIT' AND NEW.validity <> 'LATE' THEN
    RAISE EXCEPTION 'Positions after delivery must be marked LATE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_distribution_position_scope BEFORE INSERT ON distribution_position
  FOR EACH ROW EXECUTE FUNCTION fn_distribution_position_scope();

-- 5. Route seal, created with the final DELIVERY attestation ---------------------
CREATE TABLE distribution_route_seal (
  transfer_id uuid PRIMARY KEY REFERENCES distribution_transfer(id) ON DELETE RESTRICT,
  digest_hash varchar(64) NOT NULL CHECK (digest_hash ~ '^[0-9a-f]{64}$'),
  schema_version varchar(40) NOT NULL DEFAULT 'distribution-route-1',
  canonicalization_version varchar(40) NOT NULL DEFAULT 'RFC8785-JCS-v1',
  source varchar(20) NOT NULL CHECK (source IN ('DEVICE', 'SIMULATED', 'NONE')),
  point_count integer NOT NULL CHECK (point_count >= 0),
  anomaly_count integer NOT NULL CHECK (anomaly_count >= 0),
  distance_m integer NOT NULL CHECK (distance_m >= 0),
  coverage_percent numeric(5,2) NOT NULL CHECK (coverage_percent BETWEEN 0 AND 100),
  max_gap_seconds integer NOT NULL CHECK (max_gap_seconds >= 0),
  period_start timestamptz(6) NOT NULL,
  period_end timestamptz(6) NOT NULL CHECK (period_end >= period_start),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_distribution_route_seal_append_only BEFORE UPDATE OR DELETE ON distribution_route_seal
  FOR EACH ROW EXECUTE FUNCTION fn_distribution_position_append_only();

-- 6. Site coordinates (both or none) -----------------------------------------------
ALTER TABLE enterprise_site
  ADD COLUMN latitude numeric(9,6),
  ADD COLUMN longitude numeric(9,6),
  ADD CONSTRAINT ck_enterprise_site_coordinates CHECK (
    (latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)));

-- 7. Enterprise permissions --------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_enterprise_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.permissions <@ ARRAY['profile.read','profile.manage','members.read','members.manage','roles.manage','partners.read','partners.manage','catalog.read','catalog.manage','sites.read','sites.manage','vehicles.read','vehicles.manage','production.read','production.write','distribution.read','distribution.write','distribution.sign','trace.read','qr.manage','reports.read','quantity.adjust','cases.read','cases.respond','inventory.manage','quarantine.manage','evidence.read','evidence.manage','materials.read','materials.manage','processing.read','processing.write','devices.read','devices.manage']::text[]
 THEN RAISE EXCEPTION 'Unknown enterprise permission'; END IF;
 RETURN NEW;
END $$;
