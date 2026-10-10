-- Controlled migration: partial uniqueness and audit protections intentionally
-- require SQL review and rehearsal through the existing CD migration gate.
CREATE TABLE compliance_assignment (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_user_id UUID NOT NULL REFERENCES app_user(user_id),
  farm_id UUID NOT NULL REFERENCES farm(farm_id),
  granted_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ(6),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
CREATE UNIQUE INDEX ux_compliance_assignment_active
  ON compliance_assignment(reviewer_user_id, farm_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_compliance_assignment_farm ON compliance_assignment(farm_id, revoked_at);
CREATE TABLE compliance_assignment_audit (
  assignment_audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES compliance_assignment(assignment_id),
  action VARCHAR(30) NOT NULL CHECK (action IN ('GRANTED', 'REVOKED')),
  actor_user_id UUID NOT NULL REFERENCES app_user(user_id),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX ix_compliance_assignment_audit_time ON compliance_assignment_audit(assignment_id, recorded_at);
CREATE TRIGGER trg_compliance_assignment_audit_immutable BEFORE UPDATE OR DELETE ON compliance_assignment_audit
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

CREATE FUNCTION protect_compliance_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'compliance_assignment cannot be deleted'; END IF;
  IF NEW.assignment_id <> OLD.assignment_id OR NEW.reviewer_user_id <> OLD.reviewer_user_id
     OR NEW.farm_id <> OLD.farm_id OR NEW.granted_at <> OLD.granted_at
     OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'compliance_assignment permits only one revocation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_compliance_assignment_revoke_only BEFORE UPDATE OR DELETE ON compliance_assignment
  FOR EACH ROW EXECUTE FUNCTION protect_compliance_assignment();
