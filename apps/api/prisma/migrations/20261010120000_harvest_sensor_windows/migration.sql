-- Controlled migration. Keep legacy sensor_digest and its unique final-cycle
-- index intact. These new records are append-only audit evidence.
CREATE TABLE cycle_sensor_reconciliation (
  reconciliation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES production_cycle(cycle_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  through_harvest_id UUID REFERENCES harvest_event(harvest_id),
  planted_at TIMESTAMPTZ(6) NOT NULL,
  cutoff_end TIMESTAMPTZ(6),
  recorded_by_id UUID NOT NULL REFERENCES app_user(user_id),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_cycle_sensor_reconciliation_revision UNIQUE(cycle_id, revision),
  CHECK ((through_harvest_id IS NULL) = (cutoff_end IS NULL)),
  CHECK (cutoff_end IS NULL OR cutoff_end >= planted_at)
);
CREATE TABLE harvest_sensor_window (
  window_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES production_cycle(cycle_id),
  harvest_id UUID NOT NULL UNIQUE REFERENCES harvest_event(harvest_id),
  period_start TIMESTAMPTZ(6) NOT NULL,
  period_end TIMESTAMPTZ(6) NOT NULL,
  include_start BOOLEAN NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('FINALIZED', 'NO_DATA')),
  reading_count INTEGER NOT NULL CHECK (reading_count >= 0),
  digest_hash VARCHAR(64),
  schema_version VARCHAR(50) NOT NULL DEFAULT 'harvest-sensor-1',
  finalized_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  sealed_at TIMESTAMPTZ(6),
  reconciliation_id UUID REFERENCES cycle_sensor_reconciliation(reconciliation_id),
  CONSTRAINT uq_harvest_sensor_window_cutoff UNIQUE(cycle_id, period_end),
  CHECK (period_end > period_start),
  CHECK ((status = 'NO_DATA' AND reading_count = 0 AND digest_hash IS NULL)
    OR (status = 'FINALIZED' AND reading_count > 0 AND digest_hash IS NOT NULL AND digest_hash ~ '^[a-f0-9]{64}$'))
);
CREATE INDEX ix_harvest_sensor_window_cycle ON harvest_sensor_window(cycle_id, period_end);
CREATE TABLE harvest_sensor_membership (
  window_id UUID NOT NULL REFERENCES harvest_sensor_window(window_id),
  reading_id UUID NOT NULL UNIQUE REFERENCES sensor_reading(reading_id),
  PRIMARY KEY(window_id, reading_id)
);
CREATE TABLE late_sensor_reading (
  reading_id UUID PRIMARY KEY REFERENCES sensor_reading(reading_id),
  closed_harvest_id UUID NOT NULL REFERENCES harvest_event(harvest_id),
  detected_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE FUNCTION validate_harvest_sensor_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'harvest_sensor_window' THEN
    IF NOT EXISTS (SELECT 1 FROM harvest_event h WHERE h.harvest_id = NEW.harvest_id
      AND h.cycle_id = NEW.cycle_id AND h.harvest_time = NEW.period_end) THEN
      RAISE EXCEPTION 'window must match its harvest cycle and cutoff';
    END IF;
  ELSIF TG_TABLE_NAME = 'harvest_sensor_membership' THEN
    IF NOT EXISTS (SELECT 1 FROM sensor_reading r JOIN harvest_sensor_window w ON w.window_id = NEW.window_id
      WHERE r.reading_id = NEW.reading_id AND r.cycle_id = w.cycle_id AND w.sealed_at IS NULL AND w.status = 'FINALIZED'
      AND r.recorded_at <= w.period_end
      AND (r.recorded_at > w.period_start OR (w.include_start AND r.recorded_at = w.period_start)))
      OR EXISTS (SELECT 1 FROM late_sensor_reading l WHERE l.reading_id = NEW.reading_id) THEN
      RAISE EXCEPTION 'reading is outside the window or arrived late';
    END IF;
  ELSIF TG_TABLE_NAME = 'late_sensor_reading' THEN
    IF NOT EXISTS (SELECT 1 FROM sensor_reading r JOIN harvest_event h ON h.harvest_id = NEW.closed_harvest_id
      WHERE r.reading_id = NEW.reading_id AND r.cycle_id = h.cycle_id AND r.recorded_at <= h.harvest_time)
      OR EXISTS (SELECT 1 FROM harvest_sensor_membership m WHERE m.reading_id = NEW.reading_id) THEN
      RAISE EXCEPTION 'late marker must reference a closed harvest in the same cycle';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_harvest_sensor_window_validate BEFORE INSERT ON harvest_sensor_window
  FOR EACH ROW EXECUTE FUNCTION validate_harvest_sensor_evidence();
CREATE TRIGGER trg_harvest_sensor_membership_validate BEFORE INSERT ON harvest_sensor_membership
  FOR EACH ROW EXECUTE FUNCTION validate_harvest_sensor_evidence();
CREATE TRIGGER trg_late_sensor_reading_validate BEFORE INSERT ON late_sensor_reading
  FOR EACH ROW EXECUTE FUNCTION validate_harvest_sensor_evidence();
CREATE FUNCTION seal_harvest_sensor_window() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'harvest_sensor_window is immutable'; END IF;
  IF OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL
     OR (to_jsonb(NEW) - 'sealed_at') <> (to_jsonb(OLD) - 'sealed_at') THEN
    RAISE EXCEPTION 'harvest_sensor_window permits only initial sealing';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_harvest_sensor_window_immutable BEFORE UPDATE OR DELETE ON harvest_sensor_window
  FOR EACH ROW EXECUTE FUNCTION seal_harvest_sensor_window();
CREATE FUNCTION require_sealed_harvest_sensor_window() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM harvest_sensor_window w WHERE w.window_id = NEW.window_id
      AND w.sealed_at IS NOT NULL AND w.reading_count =
        (SELECT count(*) FROM harvest_sensor_membership m WHERE m.window_id = w.window_id)) THEN
    RAISE EXCEPTION 'harvest window must be sealed with complete membership in the same transaction';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_harvest_sensor_window_complete AFTER INSERT OR UPDATE ON harvest_sensor_window
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_sealed_harvest_sensor_window();
CREATE TRIGGER trg_harvest_sensor_membership_immutable BEFORE UPDATE OR DELETE ON harvest_sensor_membership
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_late_sensor_reading_immutable BEFORE UPDATE OR DELETE ON late_sensor_reading
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_cycle_sensor_reconciliation_immutable BEFORE UPDATE OR DELETE ON cycle_sensor_reconciliation
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_sensor_reading_immutable BEFORE UPDATE OR DELETE ON sensor_reading
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_sensor_digest_immutable BEFORE UPDATE OR DELETE ON sensor_digest
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_quantity_movement_immutable BEFORE UPDATE OR DELETE ON quantity_movement
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
