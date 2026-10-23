ALTER TABLE distribution_transfer
  ADD COLUMN planned_pickup_at timestamptz(6),
  ADD COLUMN planned_delivery_at timestamptz(6),
  ADD COLUMN note varchar(1000),
  ADD CONSTRAINT distribution_transfer_schedule_order
    CHECK (planned_delivery_at IS NULL OR planned_pickup_at IS NULL OR planned_delivery_at >= planned_pickup_at);
