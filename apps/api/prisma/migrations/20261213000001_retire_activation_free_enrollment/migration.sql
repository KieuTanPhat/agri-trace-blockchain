-- Every registered enterprise now goes through service activation; the
-- activation-free enrollment (ACTIVE_LEGACY) is retired. Organizations the
-- platform operator provisions without an enrollment are unaffected.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM enterprise_enrollment WHERE NOT activation_required) THEN
    RAISE EXCEPTION 'Activation-free enrollments exist; clean or rebuild this database before migrating';
  END IF;
END $$;

DROP TRIGGER trg_enterprise_activation_flag ON enterprise_enrollment;
DROP FUNCTION guard_enterprise_activation_flag();

CREATE OR REPLACE FUNCTION check_enterprise_paid_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM enterprise_enrollment e WHERE e.organization_id=NEW.organization_id AND (e.status<>'APPROVED' OR e.service_activated_at IS NULL))
  AND (EXISTS(SELECT 1 FROM organization_capability WHERE organization_id=NEW.organization_id AND revoked_at IS NULL) OR EXISTS(SELECT 1 FROM scoped_role_grant WHERE organization_id=NEW.organization_id AND revoked_at IS NULL))
 THEN RAISE EXCEPTION 'Business authority requires reviewed manual activation'; END IF;
 RETURN NULL;
END $$;

ALTER TABLE enterprise_enrollment DROP COLUMN activation_required;
