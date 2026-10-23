-- Evidence rows stay immutable. A product photo that should no longer be
-- shown is withdrawn by an append-only record; the file and its hash remain
-- for audit. Only product photos may be withdrawn.
CREATE TABLE trace_evidence_withdrawal (
  evidence_id uuid PRIMARY KEY REFERENCES trace_evidence(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) >= 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trace_evidence_withdrawal_org ON trace_evidence_withdrawal(organization_id);
CREATE FUNCTION guard_evidence_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM trace_evidence e
     WHERE e.id = NEW.evidence_id
       AND e.organization_id = NEW.organization_id
       AND e.entity_type = 'PRODUCT'
  ) THEN
    RAISE EXCEPTION 'Only product photos of the same organization can be withdrawn';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trace_evidence_withdrawal_scope BEFORE INSERT ON trace_evidence_withdrawal
  FOR EACH ROW EXECUTE FUNCTION guard_evidence_withdrawal();
CREATE TRIGGER trace_evidence_withdrawal_immutable BEFORE UPDATE OR DELETE ON trace_evidence_withdrawal
  FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
