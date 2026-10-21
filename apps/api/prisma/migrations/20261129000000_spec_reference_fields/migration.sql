-- Optional reference fields from the business specification (aaa.txt):
-- production area crop code, input/seed materials and linked facility; the
-- staff member in charge of a facility. Existing rows keep NULL/empty.
-- Material arrays cannot carry foreign keys; the API checks they belong to the
-- same organization and kind. Facility and staff stay inside the organization
-- through composite foreign keys.
ALTER TABLE farm
  ADD COLUMN crop_code varchar(100),
  ADD COLUMN input_material_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN seed_material_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN linked_site_id uuid,
  ADD CONSTRAINT farm_input_materials_max CHECK (cardinality(input_material_ids) <= 50),
  ADD CONSTRAINT farm_seed_materials_max CHECK (cardinality(seed_material_ids) <= 50),
  ADD CONSTRAINT farm_linked_site_fk
    FOREIGN KEY (linked_site_id, organization_id) REFERENCES enterprise_site(id, organization_id);

ALTER TABLE enterprise_site
  ADD COLUMN staff_user_id uuid,
  ADD CONSTRAINT enterprise_site_staff_user_fk
    FOREIGN KEY (staff_user_id, organization_id) REFERENCES app_user(user_id, organization_id);
