ALTER TABLE app_user
  ADD COLUMN phone varchar(30),
  ADD COLUMN job_title varchar(255),
  ADD COLUMN work_site_id uuid REFERENCES enterprise_site(id) ON DELETE RESTRICT,
  ADD COLUMN responsible_farm_id uuid REFERENCES farm(farm_id) ON DELETE RESTRICT,
  ADD COLUMN contact_address varchar(500),
  ADD COLUMN member_note varchar(1000);

ALTER TABLE enterprise_invitation
  ADD COLUMN phone varchar(30),
  ADD COLUMN job_title varchar(255),
  ADD COLUMN work_site_id uuid REFERENCES enterprise_site(id) ON DELETE RESTRICT,
  ADD COLUMN responsible_farm_id uuid REFERENCES farm(farm_id) ON DELETE RESTRICT,
  ADD COLUMN contact_address varchar(500),
  ADD COLUMN member_note varchar(1000);

ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_entity_type_check;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_entity_type_check
  CHECK (entity_type IN ('PRODUCT','FARM','SITE','CYCLE','LOT','TRANSFER','MATERIAL','PROFILE','EXTERNAL_PARTNER','MEMBER'));
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_kind_chk;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_kind_chk
  CHECK (kind IN ('OTHER','PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE','PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE','SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','LOT_DOCUMENT','SITE_IMAGE','BUSINESS_LICENSE','TRANSFER_IMAGE','HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO','MEMBER_AVATAR','MEMBER_DOCUMENT'));
