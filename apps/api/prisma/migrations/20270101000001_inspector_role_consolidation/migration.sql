-- Gộp vai COMPLIANCE_REVIEWER của tài khoản vào vai Kiểm định (AUDITOR), quyết định
-- ngày 04/11/2026. Chỉ đổi app_role/app_user; grant ScopedRole COMPLIANCE_REVIEWER
-- trên chuỗi, assignment, audit, journal, trace, outbox và proof giữ nguyên.
UPDATE app_role
SET name = 'Kiểm định',
    description = 'Đọc dữ liệu truy xuất; ghi kiểm định trên nông trại được phân công'
WHERE code = 'AUDITOR';

UPDATE app_user u
SET role_id = inspector.role_id, version = u.version + 1
FROM app_role old, app_role inspector
WHERE u.role_id = old.role_id
  AND old.code = 'COMPLIANCE_REVIEWER'
  AND inspector.code = 'AUDITOR';

DELETE FROM app_role WHERE code = 'COMPLIANCE_REVIEWER';
