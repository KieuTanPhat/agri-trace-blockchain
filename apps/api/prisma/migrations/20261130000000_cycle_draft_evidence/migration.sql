-- Photos may be attached to a production-cycle draft. Evidence rows stay
-- immutable: a linked cycle keeps the draft id, so the rows already point at
-- the cycle and the link command records EVIDENCE_ATTACHED for each of them.
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_entity_type_check;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_entity_type_check
  CHECK (entity_type IN ('PRODUCT','FARM','SITE','CYCLE','CYCLE_DRAFT','LOT','TRANSFER','MATERIAL','PROFILE','EXTERNAL_PARTNER','MEMBER','CHAIN','SITE_TRANSFER','QUARANTINE'));
