INSERT INTO app_role(code,name,description) VALUES ('DISTRIBUTOR','Nhà phân phối','Thành viên doanh nghiệp phân phối phục vụ truy xuất') ON CONFLICT(code) DO NOTHING;
-- Align account metadata only. Existing event actor roles/hashes stay immutable.
UPDATE app_user u SET role_id=r.role_id FROM organization o,app_role r,enterprise_enrollment e
 WHERE u.organization_id=o.organization_id AND e.organization_id=o.organization_id AND o.type='DISTRIBUTOR' AND r.code='DISTRIBUTOR';
CREATE OR REPLACE FUNCTION guard_enterprise_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE supervisor app_user%ROWTYPE; supervisor_level integer;
BEGIN
 IF NEW.enterprise_tier IN (2,3) THEN
   SELECT * INTO supervisor FROM app_user WHERE user_id=NEW.supervisor_id FOR SHARE;
   supervisor_level:=supervisor.enterprise_tier;
   IF supervisor_level IS NULL AND EXISTS(SELECT 1 FROM scoped_role_grant WHERE user_id=supervisor.user_id AND organization_id=NEW.organization_id AND scope='ORGANIZATION' AND role='ORG_ADMIN' AND revoked_at IS NULL) THEN supervisor_level:=1; END IF;
   IF supervisor.user_id IS NULL OR supervisor.organization_id IS DISTINCT FROM NEW.organization_id OR supervisor_level IS NULL OR supervisor_level>=NEW.enterprise_tier
   THEN RAISE EXCEPTION 'Invalid enterprise hierarchy'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.enterprise_tier,NEW.supervisor_id) IS DISTINCT FROM (OLD.enterprise_tier,OLD.supervisor_id)
 THEN RAISE EXCEPTION 'Enterprise hierarchy requires an explicit ownership transfer'; END IF;
 RETURN NEW;
END $$;
