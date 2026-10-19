ALTER TABLE production_cycle
  ADD COLUMN seed_material_id uuid REFERENCES production_material(id) ON DELETE RESTRICT,
  ADD COLUMN responsible_user_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  ADD COLUMN cultivation_method varchar(255);

ALTER TABLE production_cycle_draft
  ADD COLUMN seed_material_id uuid REFERENCES production_material(id) ON DELETE RESTRICT,
  ADD COLUMN responsible_user_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  ADD COLUMN cultivation_method varchar(255);
