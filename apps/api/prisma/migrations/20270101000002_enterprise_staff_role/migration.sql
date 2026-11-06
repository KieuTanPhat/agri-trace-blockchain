-- Vai Nhân viên doanh nghiệp (ENTERPRISE_STAFF), quyết định ngày 04/11/2026.
-- Thành viên cấp 2/3 của tổ chức nghiệp vụ chuyển sang vai này. Loại nghiệp vụ
-- lấy từ organization.type, quyền chi tiết vẫn lấy từ enterprise_role. Chủ doanh
-- nghiệp (cấp 1 hoặc chưa phân cấp) giữ vai nghiệp vụ. Grant ScopedRole trên
-- chuỗi, audit, journal, trace, outbox và proof giữ nguyên.
INSERT INTO app_role (code, name, description) VALUES
  ('ENTERPRISE_STAFF', 'Nhân viên doanh nghiệp',
   'Thành viên cấp 2/3; nghiệp vụ theo loại tổ chức, quyền theo nhóm quyền doanh nghiệp')
ON CONFLICT (code) DO NOTHING;

UPDATE app_user u
SET role_id = staff.role_id, version = u.version + 1
FROM app_role old_role, app_role staff, organization o
WHERE u.role_id = old_role.role_id
  AND staff.code = 'ENTERPRISE_STAFF'
  AND u.organization_id = o.organization_id
  AND u.enterprise_tier IN (2, 3)
  AND o.type::text IN ('FARM', 'TRANSPORTER', 'DISTRIBUTOR', 'PROCESSOR', 'RETAILER')
  AND old_role.code IN ('FARM_STAFF', 'TRANSPORTER', 'DISTRIBUTOR', 'PROCESSOR', 'RETAILER');
