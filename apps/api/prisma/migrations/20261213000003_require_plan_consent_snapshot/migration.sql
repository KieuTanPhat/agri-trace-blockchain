-- Every shipment plan consent carries the membership and capability snapshot it
-- was given under; consents recorded before that snapshot existed are retired.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM shipment_plan_acceptance
             WHERE membership_id IS NULL OR membership_version IS NULL OR capability_revision IS NULL)
  THEN
    RAISE EXCEPTION 'Shipment plan consents without a snapshot exist; clean or rebuild this database before migrating';
  END IF;
END $$;

ALTER TABLE shipment_plan_acceptance
  ALTER COLUMN membership_id SET NOT NULL,
  ALTER COLUMN membership_version SET NOT NULL,
  ALTER COLUMN capability_revision SET NOT NULL;
