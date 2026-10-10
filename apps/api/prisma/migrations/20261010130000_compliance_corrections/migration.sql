-- Controlled migration: reviewed triggers and partial indexes are required.
-- Historical certificates/inspections remain unchanged; new actor columns are nullable.
ALTER TABLE certificate ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD COLUMN submitted_by_user_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD COLUMN supersedes_id uuid REFERENCES certificate(certificate_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD COLUMN correction_reason text,
  ADD CONSTRAINT ck_certificate_correction_reason CHECK (
    (supersedes_id IS NULL AND correction_reason IS NULL) OR
    (supersedes_id IS NOT NULL AND supersedes_id <> certificate_id AND correction_reason IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 1 AND 1000)
  ),
  ADD CONSTRAINT ck_certificate_review_version CHECK (version >= 0);
CREATE INDEX ix_certificate_supersedes ON certificate(supersedes_id);
CREATE UNIQUE INDEX uq_certificate_pending_correction ON certificate(supersedes_id)
  WHERE supersedes_id IS NOT NULL AND status = 'PENDING';
CREATE UNIQUE INDEX uq_certificate_approved_correction ON certificate(supersedes_id)
  WHERE supersedes_id IS NOT NULL AND status = 'APPROVED';
ALTER TABLE inspection ADD COLUMN recorded_by_user_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD COLUMN supersedes_id uuid UNIQUE REFERENCES inspection(inspection_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD COLUMN correction_reason text,
  ADD CONSTRAINT ck_inspection_correction_reason CHECK (
    (supersedes_id IS NULL AND correction_reason IS NULL) OR
    (supersedes_id IS NOT NULL AND supersedes_id <> inspection_id AND correction_reason IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 1 AND 1000)
  );

CREATE FUNCTION validate_compliance_correction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor certificate%ROWTYPE; previous_inspection inspection%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'certificate' THEN
    IF NEW.status <> 'PENDING' OR NEW.version <> 0 OR NEW.submitted_by_user_id IS NULL
      OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'New certificates must be pending and attributed';
    END IF;
    IF (NEW.lot_id IS NULL) = (NEW.cycle_id IS NULL) THEN
      RAISE EXCEPTION 'Certificate requires exactly one subject';
    END IF;
    IF NEW.document_hash !~ '^[a-f0-9]{64}$' OR length(btrim(NEW.document_ref)) NOT BETWEEN 1 AND 2048
      OR length(btrim(NEW.type)) NOT BETWEEN 1 AND 120 OR length(btrim(NEW.issuer)) NOT BETWEEN 1 AND 255
      OR (NEW.expiry_date IS NOT NULL AND NEW.expiry_date < NEW.issue_date) THEN
      RAISE EXCEPTION 'Invalid certificate content';
    END IF;
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT * INTO predecessor FROM certificate WHERE certificate_id = NEW.supersedes_id;
      IF NOT FOUND OR predecessor.status <> 'APPROVED'
        OR predecessor.lot_id IS DISTINCT FROM NEW.lot_id OR predecessor.cycle_id IS DISTINCT FROM NEW.cycle_id
        OR EXISTS (SELECT 1 FROM certificate WHERE supersedes_id = predecessor.certificate_id AND status = 'APPROVED') THEN
        RAISE EXCEPTION 'Certificate correction must replace the effective approved subject';
      END IF;
    END IF;
  ELSE
    IF NEW.recorded_by_user_id IS NULL THEN RAISE EXCEPTION 'Inspection requires its reviewer'; END IF;
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT * INTO previous_inspection FROM inspection WHERE inspection_id = NEW.supersedes_id;
      IF NOT FOUND OR previous_inspection.lot_id <> NEW.lot_id THEN
        RAISE EXCEPTION 'Inspection correction must retain its Lot';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_certificate_insert BEFORE INSERT ON certificate
  FOR EACH ROW EXECUTE FUNCTION validate_compliance_correction();
CREATE TRIGGER validate_inspection_insert BEFORE INSERT ON inspection
  FOR EACH ROW EXECUTE FUNCTION validate_compliance_correction();

CREATE FUNCTION protect_certificate_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Certificates are immutable'; END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('APPROVED', 'REJECTED')
    OR NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL OR NEW.version <> OLD.version + 1
    OR (to_jsonb(NEW) - ARRAY['status','reviewed_by','reviewed_at','review_note','version'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','reviewed_by','reviewed_at','review_note','version']) THEN
    RAISE EXCEPTION 'Certificate review is a single immutable decision';
  END IF;
  IF NEW.submitted_by_user_id = NEW.reviewed_by THEN RAISE EXCEPTION 'Self review is forbidden'; END IF;
  IF EXISTS (
    WITH RECURSIVE ancestry AS (
      SELECT certificate_id, supersedes_id, submitted_by_user_id FROM certificate WHERE certificate_id = OLD.certificate_id
      UNION
      SELECT parent.certificate_id, parent.supersedes_id, parent.submitted_by_user_id
        FROM certificate parent JOIN ancestry child ON parent.certificate_id = child.supersedes_id
    )
    SELECT 1 FROM ancestry a WHERE a.submitted_by_user_id = NEW.reviewed_by OR EXISTS (
      SELECT 1 FROM trace_event e WHERE e.entity_type = 'CERTIFICATE' AND e.entity_id = a.certificate_id
        AND e.event_type = 'CERTIFICATE_SUBMITTED' AND e.actor_user_id = NEW.reviewed_by
    )
  ) THEN RAISE EXCEPTION 'Self review of certificate ancestry is forbidden'; END IF;
  IF NEW.status = 'APPROVED' AND NEW.supersedes_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM certificate WHERE supersedes_id = NEW.supersedes_id AND status = 'APPROVED'
  ) THEN RAISE EXCEPTION 'Certificate already replaced'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_certificate_decision BEFORE UPDATE OR DELETE ON certificate
  FOR EACH ROW EXECUTE FUNCTION protect_certificate_review();
CREATE TRIGGER protect_inspection_history BEFORE UPDATE OR DELETE ON inspection
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
