CREATE TABLE enterprise_invitation (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organization(organization_id),
 creator_id uuid NOT NULL, email varchar(255) NOT NULL, full_name varchar(255) NOT NULL,
 tier integer NOT NULL CHECK(tier IN (2,3)), roles jsonb NOT NULL, token_digest varchar(64) NOT NULL,
 authority_scope varchar(64) NOT NULL, delegation_digest varchar(64) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')),
 expires_at timestamptz(6) NOT NULL, accepted_at timestamptz(6), accepted_user_id uuid REFERENCES app_user(user_id),
 acceptance_request_id uuid UNIQUE, acceptance_digest varchar(64), version integer NOT NULL DEFAULT 0,
 created_at timestamptz(6) NOT NULL DEFAULT now(), FOREIGN KEY(creator_id,organization_id) REFERENCES app_user(user_id,organization_id),
 CHECK((status='ACCEPTED')=(accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL AND acceptance_request_id IS NOT NULL AND acceptance_digest IS NOT NULL))
);
CREATE INDEX invitation_creator ON enterprise_invitation(organization_id,creator_id);
CREATE UNIQUE INDEX invitation_pending_email ON enterprise_invitation(organization_id,email) WHERE status='PENDING';
CREATE FUNCTION guard_member_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invitation history is immutable'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.creator_id,NEW.email,NEW.full_name,NEW.tier,NEW.roles,NEW.token_digest,NEW.authority_scope,NEW.delegation_digest,NEW.expires_at,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.creator_id,OLD.email,OLD.full_name,OLD.tier,OLD.roles,OLD.token_digest,OLD.authority_scope,OLD.delegation_digest,OLD.expires_at,OLD.created_at)
 OR OLD.status<>'PENDING' OR NEW.status NOT IN ('ACCEPTED','EXPIRED','REVOKED') OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid invitation transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER member_invitation_guard BEFORE UPDATE OR DELETE ON enterprise_invitation FOR EACH ROW EXECUTE FUNCTION guard_member_invitation();
-- Existing organization administrators may predate explicit tier fields.
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
 IF TG_OP='UPDATE' AND (NEW.enterprise_tier,NEW.supervisor_id) IS DISTINCT FROM (OLD.enterprise_tier,OLD.supervisor_id) THEN RAISE EXCEPTION 'Hierarchy requires explicit ownership transfer'; END IF;
 RETURN NEW;
END $$;
