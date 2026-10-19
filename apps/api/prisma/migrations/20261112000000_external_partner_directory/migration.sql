CREATE TABLE enterprise_external_partner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  business_id varchar(40) NOT NULL,
  name varchar(255) NOT NULL,
  kind varchar(30) NOT NULL,
  address varchar(500) NOT NULL,
  phone varchar(30),
  email varchar(255),
  tax_code varchar(40),
  representative varchar(255),
  note varchar(1000),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_external_partner_kind_chk CHECK (kind IN ('FARM','TRANSPORTER','DISTRIBUTOR','RETAILER')),
  CONSTRAINT enterprise_external_partner_version_chk CHECK (version >= 0),
  CONSTRAINT enterprise_external_partner_org_business_key UNIQUE (organization_id, business_id)
);
CREATE INDEX enterprise_external_partner_org_name_idx
  ON enterprise_external_partner (organization_id, name);

ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_entity_type_check;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_entity_type_check
  CHECK (entity_type IN ('PRODUCT','FARM','SITE','CYCLE','LOT','TRANSFER','MATERIAL','PROFILE','EXTERNAL_PARTNER'));

ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_kind_chk;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_kind_chk CHECK (kind IN (
  'OTHER', 'PRODUCT_IMAGE', 'INSPECTION_IMAGE', 'AREA_IMAGE', 'LAND_CERTIFICATE',
  'PRODUCTION_CONTRACT', 'QUALITY_CERTIFICATE', 'CYCLE_IMAGE', 'MATERIAL_IMAGE',
  'SEED_IMAGE', 'CERTIFICATE_IMAGE', 'LOT_IMAGE', 'LOT_DOCUMENT', 'SITE_IMAGE',
  'BUSINESS_LICENSE', 'TRANSFER_IMAGE', 'HARVEST_IMAGE', 'CARE_IMAGE', 'PARTNER_LOGO'
));
