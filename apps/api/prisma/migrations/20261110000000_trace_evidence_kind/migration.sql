ALTER TABLE trace_evidence
  ADD COLUMN kind varchar(40) NOT NULL DEFAULT 'OTHER';

ALTER TABLE trace_evidence
  ADD CONSTRAINT trace_evidence_kind_chk CHECK (kind IN (
    'OTHER', 'PRODUCT_IMAGE', 'INSPECTION_IMAGE',
    'AREA_IMAGE', 'LAND_CERTIFICATE', 'PRODUCTION_CONTRACT', 'QUALITY_CERTIFICATE',
    'CYCLE_IMAGE', 'MATERIAL_IMAGE', 'SEED_IMAGE', 'CERTIFICATE_IMAGE',
    'LOT_IMAGE', 'LOT_DOCUMENT', 'SITE_IMAGE', 'BUSINESS_LICENSE',
    'TRANSFER_IMAGE', 'HARVEST_IMAGE', 'CARE_IMAGE'
  ));

CREATE INDEX trace_evidence_subject_kind_idx
  ON trace_evidence (organization_id, entity_type, entity_id, kind);
