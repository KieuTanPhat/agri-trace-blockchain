-- Existing SYSTEM_ADMIN accounts retain their authority. New accounts can
-- receive a narrower platform role; none of these roles writes business data.
INSERT INTO app_role (code, name, description) VALUES
  ('PLATFORM_OPERATOR', 'Vận hành nền tảng', 'Chỉ đọc bảng vận hành và diễn tập thu hồi'),
  ('PLATFORM_CASE_MANAGER', 'Điều phối sự cố', 'Quản lý hồ sơ sự cố và diễn tập; không thay đổi lô'),
  ('PLATFORM_PRIVACY_OFFICER', 'Phụ trách dữ liệu cá nhân', 'Xử lý hộp thư quyền dữ liệu và hồ sơ vi phạm')
ON CONFLICT (code) DO NOTHING;
