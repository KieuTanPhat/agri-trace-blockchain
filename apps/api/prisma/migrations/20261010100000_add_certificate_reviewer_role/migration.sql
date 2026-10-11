INSERT INTO public.app_role (code, name, description)
VALUES (
  'CERTIFICATE_REVIEWER',
  'Người kiểm tra hồ sơ chứng chỉ',
  'Duyệt hoặc từ chối chứng chỉ do trang trại gửi'
)
ON CONFLICT (code) DO NOTHING;
