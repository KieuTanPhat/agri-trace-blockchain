ALTER TABLE care_record
  ADD COLUMN IF NOT EXISTS evidence_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

ALTER TABLE harvest_event
  ADD COLUMN IF NOT EXISTS representative_user_id uuid,
  ADD COLUMN IF NOT EXISTS evidence_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

ALTER TABLE harvest_event
  ADD CONSTRAINT harvest_representative_user_fk
  FOREIGN KEY (representative_user_id) REFERENCES app_user(user_id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
