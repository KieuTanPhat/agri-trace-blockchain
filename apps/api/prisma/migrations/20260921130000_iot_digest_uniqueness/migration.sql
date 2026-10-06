-- Digest windows are immutable aggregation boundaries. These constraints make
-- retries/concurrent workers unable to create duplicate blockchain anchors.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sensor_digest_window
  ON sensor_digest (cycle_id, period_start, period_end);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sensor_digest_final_cycle
  ON sensor_digest (cycle_id)
  WHERE is_final = true;
