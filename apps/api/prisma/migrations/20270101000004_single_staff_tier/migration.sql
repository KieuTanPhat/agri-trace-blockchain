-- Bỏ cấp quản lý (cấp 2), quyết định ngày 04/11/2026: chỉ chủ doanh nghiệp quản
-- trị thành viên và nhóm quyền; mọi nhân viên ở cấp 3, trực thuộc chủ, chỉ thấy
-- và ghi vụ được giao. Không đổi grant trên chuỗi, audit, journal, trace, proof.

-- Đây là thay đổi phân cấp có chủ đích, không phải chuyển quyền sở hữu: tạm tắt
-- guard trong transaction của migration, rồi bật lại với quy tắc mới bên dưới.
ALTER TABLE app_user DISABLE TRIGGER enterprise_hierarchy_guard;

-- Nhân viên đang dưới một quản lý cấp 2 chuyển về trực thuộc chủ của quản lý đó.
UPDATE app_user staff
SET supervisor_id = manager.supervisor_id,
    enterprise_revision = staff.enterprise_revision + 1,
    version = staff.version + 1
FROM app_user manager
WHERE staff.supervisor_id = manager.user_id
  AND manager.enterprise_tier = 2;

UPDATE app_user
SET enterprise_tier = 3,
    enterprise_revision = enterprise_revision + 1,
    version = version + 1
WHERE enterprise_tier = 2;

ALTER TABLE app_user ENABLE TRIGGER enterprise_hierarchy_guard;

-- Lời mời đang chờ ở cấp 2 hoặc do một nhân viên tạo không còn hợp lệ.
UPDATE enterprise_invitation invitation
SET status = 'REVOKED', version = invitation.version + 1
FROM app_user creator
WHERE invitation.creator_id = creator.user_id
  AND invitation.status = 'PENDING'
  AND (invitation.tier = 2 OR creator.enterprise_tier = 3);

ALTER TABLE app_user
  ADD CONSTRAINT ck_app_user_enterprise_tier
  CHECK (enterprise_tier IS NULL OR enterprise_tier IN (1, 3));
ALTER TABLE enterprise_invitation
  ADD CONSTRAINT ck_enterprise_invitation_staff_tier
  CHECK (tier = 3 OR status <> 'PENDING');

CREATE OR REPLACE FUNCTION guard_enterprise_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE supervisor app_user%ROWTYPE;
BEGIN
 -- An employee reports to its enterprise owner: tier 1, or an organization
 -- administrator that predates explicit tiers.
 IF NEW.enterprise_tier = 3 THEN
  SELECT * INTO supervisor FROM app_user WHERE user_id=NEW.supervisor_id FOR SHARE;
  IF NOT FOUND OR supervisor.organization_id IS DISTINCT FROM NEW.organization_id
   OR NOT (supervisor.enterprise_tier IS NOT DISTINCT FROM 1
    OR (supervisor.enterprise_tier IS NULL AND EXISTS(SELECT 1 FROM scoped_role_grant WHERE user_id=supervisor.user_id AND organization_id=NEW.organization_id AND role='ORG_ADMIN' AND scope='ORGANIZATION' AND revoked_at IS NULL)))
  THEN RAISE EXCEPTION 'Invalid enterprise hierarchy'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.enterprise_tier,NEW.supervisor_id) IS DISTINCT FROM (OLD.enterprise_tier,OLD.supervisor_id)
  AND NOT EXISTS(SELECT 1 FROM enterprise_ownership_transfer t WHERE t.organization_id=NEW.organization_id AND t.status='ACCEPTED' AND t.resolved_at=now()
   AND ((NEW.user_id=t.to_user_id AND NEW.enterprise_tier=1 AND NEW.supervisor_id IS NULL)
    OR (NOT t.retain_previous_admin AND OLD.supervisor_id=t.from_user_id AND NEW.supervisor_id=t.to_user_id AND NEW.enterprise_tier IS NOT DISTINCT FROM OLD.enterprise_tier)))
 THEN RAISE EXCEPTION 'Hierarchy requires explicit ownership transfer'; END IF;
 RETURN NEW;
END $$;
