-- Gộp ba vai quản trị hẹp vào Admin (SYSTEM_ADMIN), quyết định ngày 04/11/2026.
-- Chỉ đổi vai của tài khoản; audit, journal, trace, outbox và proof giữ nguyên.
UPDATE app_user u
SET role_id = admin.role_id, version = u.version + 1
FROM app_role old, app_role admin
WHERE u.role_id = old.role_id
  AND admin.code = 'SYSTEM_ADMIN'
  AND old.code IN ('PLATFORM_OPERATOR', 'PLATFORM_CASE_MANAGER', 'PLATFORM_PRIVACY_OFFICER');

DELETE FROM app_role
WHERE code IN ('PLATFORM_OPERATOR', 'PLATFORM_CASE_MANAGER', 'PLATFORM_PRIVACY_OFFICER');
