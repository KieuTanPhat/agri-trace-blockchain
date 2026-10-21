-- Partners recorded outside AgriTrace need an image proving the cooperation
-- (contract page, signed minutes, …). Same rules as other evidence kinds.
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_kind_chk;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_kind_chk CHECK (kind IN (
  'OTHER','PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE',
  'PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE',
  'SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','LOT_DOCUMENT','SITE_IMAGE',
  'BUSINESS_LICENSE','TRANSFER_IMAGE','HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO',
  'MEMBER_AVATAR','MEMBER_DOCUMENT','CHAIN_IMAGE','QUARANTINE_IMAGE',
  'PARTNERSHIP_EVIDENCE'));
