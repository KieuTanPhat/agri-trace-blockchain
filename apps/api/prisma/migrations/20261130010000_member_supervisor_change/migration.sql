-- The owner may move a tier-3 member under another manager. Hierarchy changes
-- stay explicit: the update is accepted only next to an append-only record of
-- the same change written in the same transaction (created_at = now()), and the
-- existing tier/organization checks still apply. Ownership transfer is unchanged.
CREATE TABLE enterprise_supervisor_change (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(organization_id),
  member_id uuid NOT NULL,
  from_supervisor_id uuid,
  to_supervisor_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_supervisor_change_member_fk
    FOREIGN KEY (member_id, organization_id) REFERENCES app_user(user_id, organization_id),
  CONSTRAINT enterprise_supervisor_change_target_fk
    FOREIGN KEY (to_supervisor_id, organization_id) REFERENCES app_user(user_id, organization_id),
  CONSTRAINT enterprise_supervisor_change_distinct CHECK (to_supervisor_id <> member_id)
);
CREATE INDEX enterprise_supervisor_change_member ON enterprise_supervisor_change(organization_id, member_id, created_at);
CREATE TRIGGER enterprise_supervisor_change_immutable BEFORE UPDATE OR DELETE ON enterprise_supervisor_change
  FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();

CREATE OR REPLACE FUNCTION guard_enterprise_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE supervisor app_user%ROWTYPE;
BEGIN
 IF NEW.enterprise_tier IN (2,3) THEN
  SELECT * INTO supervisor FROM app_user WHERE user_id=NEW.supervisor_id FOR SHARE;
  IF NOT FOUND OR supervisor.organization_id IS DISTINCT FROM NEW.organization_id
   OR (supervisor.enterprise_tier IS NULL AND NOT EXISTS(SELECT 1 FROM scoped_role_grant WHERE user_id=supervisor.user_id AND organization_id=NEW.organization_id AND role='ORG_ADMIN' AND scope='ORGANIZATION' AND revoked_at IS NULL))
   OR (supervisor.enterprise_tier IS NOT NULL AND supervisor.enterprise_tier>=NEW.enterprise_tier)
  THEN RAISE EXCEPTION 'Invalid enterprise hierarchy'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.enterprise_tier,NEW.supervisor_id) IS DISTINCT FROM (OLD.enterprise_tier,OLD.supervisor_id)
  AND NOT EXISTS(SELECT 1 FROM enterprise_ownership_transfer t WHERE t.organization_id=NEW.organization_id AND t.status='ACCEPTED' AND t.resolved_at=now()
   AND ((NEW.user_id=t.to_user_id AND NEW.enterprise_tier=1 AND NEW.supervisor_id IS NULL)
    OR (NOT t.retain_previous_admin AND OLD.supervisor_id=t.from_user_id AND NEW.supervisor_id=t.to_user_id AND NEW.enterprise_tier IS NOT DISTINCT FROM OLD.enterprise_tier)))
  AND NOT EXISTS(SELECT 1 FROM enterprise_supervisor_change c WHERE c.organization_id=NEW.organization_id AND c.member_id=NEW.user_id
   AND c.created_at=now() AND c.from_supervisor_id IS NOT DISTINCT FROM OLD.supervisor_id AND c.to_supervisor_id=NEW.supervisor_id
   AND NEW.enterprise_tier=3 AND OLD.enterprise_tier=3)
 THEN RAISE EXCEPTION 'Hierarchy requires explicit ownership transfer'; END IF;
 RETURN NEW;
END $$;
