-- Level-1 ownership moves only through an explicit, accepted transfer.
-- Enrollment ownership and hierarchy changes are admitted solely inside the
-- transaction that accepts the transfer (resolved_at is pinned to now()).
CREATE TABLE enterprise_ownership_transfer (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organization(organization_id),
 from_user_id uuid NOT NULL, to_user_id uuid NOT NULL,
 enrollment_version integer, retain_previous_admin boolean NOT NULL,
 reason varchar(1000) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED')),
 version integer NOT NULL DEFAULT 0, resolution_note varchar(1000),
 expires_at timestamptz(6) NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), resolved_at timestamptz(6),
 FOREIGN KEY(from_user_id,organization_id) REFERENCES app_user(user_id,organization_id),
 FOREIGN KEY(to_user_id,organization_id) REFERENCES app_user(user_id,organization_id),
 CHECK(from_user_id<>to_user_id), CHECK(expires_at>created_at),
 CHECK((status='PENDING')=(resolved_at IS NULL))
);
CREATE INDEX enterprise_ownership_transfer_org ON enterprise_ownership_transfer(organization_id,created_at);
CREATE UNIQUE INDEX enterprise_ownership_one_pending ON enterprise_ownership_transfer(organization_id) WHERE status='PENDING';
CREATE FUNCTION guard_ownership_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Ownership transfer history is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING' OR NEW.version<>0 OR NEW.resolved_at IS NOT NULL THEN RAISE EXCEPTION 'Ownership transfer starts pending'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.id,NEW.organization_id,NEW.from_user_id,NEW.to_user_id,NEW.enrollment_version,NEW.retain_previous_admin,NEW.reason,NEW.expires_at,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.from_user_id,OLD.to_user_id,OLD.enrollment_version,OLD.retain_previous_admin,OLD.reason,OLD.expires_at,OLD.created_at)
  OR OLD.status<>'PENDING' OR NEW.status NOT IN ('ACCEPTED','DECLINED','CANCELLED','EXPIRED') OR NEW.version<>OLD.version+1
 THEN RAISE EXCEPTION 'Invalid ownership transfer transition'; END IF;
 IF NEW.status='ACCEPTED' AND OLD.expires_at<=now() THEN RAISE EXCEPTION 'Ownership transfer expired'; END IF;
 NEW.resolved_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER ownership_transfer_guard BEFORE INSERT OR UPDATE OR DELETE ON enterprise_ownership_transfer FOR EACH ROW EXECUTE FUNCTION guard_ownership_transfer();

CREATE OR REPLACE FUNCTION guard_enterprise_enrollment_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Enrollment history is immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR (NEW.id,NEW.organization_id,NEW.registration_digest,NEW.business_id,NEW.hosting_mode) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.registration_digest,OLD.business_id,OLD.hosting_mode)
 THEN RAISE EXCEPTION 'Enrollment identity or version mismatch'; END IF;
 IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
  IF OLD.status='APPROVED' AND NEW.status='APPROVED'
   AND (NEW.service_activated_at,NEW.service_activated_by,NEW.service_activation_reason,NEW.reviewed_by,NEW.review_note)
    IS NOT DISTINCT FROM (OLD.service_activated_at,OLD.service_activated_by,OLD.service_activation_reason,OLD.reviewed_by,OLD.review_note)
   AND EXISTS(SELECT 1 FROM enterprise_ownership_transfer t WHERE t.organization_id=OLD.organization_id AND t.from_user_id=OLD.owner_id
    AND t.to_user_id=NEW.owner_id AND t.status='ACCEPTED' AND t.resolved_at=now() AND t.enrollment_version=OLD.version)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Enrollment owner changes require an accepted ownership transfer';
 END IF;
 IF OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED') AND NEW.service_activated_at IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='APPROVED' AND NEW.status='APPROVED' AND OLD.service_activated_at IS NULL AND NEW.service_activated_at IS NOT NULL THEN RETURN NEW; END IF;
 IF OLD.status='REJECTED' AND NEW.status='PENDING_REVIEW' AND NEW.service_activated_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.review_note IS NULL
 AND EXISTS(SELECT 1 FROM enterprise_profile_amendment a JOIN enterprise_profile p ON p.organization_id=a.organization_id WHERE a.organization_id=OLD.organization_id AND a.status='APPROVED' AND a.profile_version=p.version-1)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Invalid enrollment transition';
END $$;

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
 THEN RAISE EXCEPTION 'Hierarchy requires explicit ownership transfer'; END IF;
 RETURN NEW;
END $$;
