-- Optional fields from aaa.txt: product partners and manager, care performer and
-- crop condition, products linked to a supply chain. Existing rows keep NULL/empty.
ALTER TABLE product
  ADD COLUMN raw_materials varchar(2000),
  ADD COLUMN manufacturing_site_id uuid,
  ADD COLUMN exporter varchar(255),
  ADD COLUMN importer varchar(255),
  ADD COLUMN distributor varchar(255),
  ADD COLUMN carrier varchar(255),
  ADD COLUMN manager_user_id uuid REFERENCES app_user(user_id),
  ADD CONSTRAINT product_manufacturing_site_fk
    FOREIGN KEY (manufacturing_site_id, organization_id) REFERENCES enterprise_site(id, organization_id);

ALTER TABLE care_record
  ADD COLUMN performer_user_id uuid REFERENCES app_user(user_id),
  ADD COLUMN crop_condition varchar(500);

ALTER TABLE supply_chain
  ADD COLUMN product_ids uuid[] NOT NULL DEFAULT '{}';
