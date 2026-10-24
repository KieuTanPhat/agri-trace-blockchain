-- Cycle-level sensor digests and the legacy cutoff reconciliation are retired.
-- Every harvest binds its own sealed sensor window (harvest-sensor-1).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sensor_digest)
     OR EXISTS (SELECT 1 FROM cycle_sensor_reconciliation)
     OR EXISTS (SELECT 1 FROM harvest_event h
                WHERE NOT EXISTS (SELECT 1 FROM harvest_sensor_window w WHERE w.harvest_id = h.harvest_id))
  THEN
    RAISE EXCEPTION 'Legacy sensor evidence exists; clean or rebuild this database before migrating';
  END IF;
END $$;

ALTER TABLE harvest_sensor_window DROP COLUMN reconciliation_id;
ALTER TABLE harvest_event DROP COLUMN final_sensor_digest_id;
DROP TABLE cycle_sensor_reconciliation;
DROP TABLE sensor_digest;
