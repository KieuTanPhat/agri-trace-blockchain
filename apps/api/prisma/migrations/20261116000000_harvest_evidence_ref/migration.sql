ALTER TABLE harvest_event ADD COLUMN evidence_ref uuid REFERENCES trace_evidence(id) ON DELETE RESTRICT;
