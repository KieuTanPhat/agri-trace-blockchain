-- A device that already sent readings or positions cannot be deleted (its data
-- backs trace pages). Removing it stops, detaches and hides it instead.
ALTER TABLE iot_device
  ADD COLUMN archived_at timestamptz(6),
  ADD CONSTRAINT ck_iot_device_archived_detached CHECK (
    archived_at IS NULL OR (status = 'INACTIVE' AND plot_id IS NULL AND vehicle_id IS NULL));
