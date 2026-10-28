-- P4-P6: platform administration console. Administrators observe and
-- coordinate; they never write lots, custody or quantities for enterprises.

-- A blocked QR keeps resolving, with a public warning, and cannot be reprinted.
CREATE TABLE trace_qr_block (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES lot(lot_id) ON DELETE RESTRICT,
  reason varchar(1000) NOT NULL,
  public_message varchar(500) NOT NULL,
  blocked_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  blocked_at timestamptz(6) NOT NULL DEFAULT now(),
  unblocked_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  unblocked_at timestamptz(6),
  unblock_reason varchar(1000),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK ((unblocked_at IS NULL) = (unblocked_by IS NULL))
);
CREATE UNIQUE INDEX uq_trace_qr_block_active ON trace_qr_block(lot_id) WHERE unblocked_at IS NULL;

-- Anonymous daily scan counters; no IP, cookie or device data is stored.
CREATE TABLE trace_scan_daily (
  lot_id uuid NOT NULL REFERENCES lot(lot_id) ON DELETE RESTRICT,
  day date NOT NULL,
  scans integer NOT NULL DEFAULT 0 CHECK (scans >= 0),
  PRIMARY KEY (lot_id, day)
);
CREATE INDEX ix_trace_scan_daily_day ON trace_scan_daily(day);

CREATE TABLE system_notice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(200) NOT NULL,
  body varchar(2000) NOT NULL,
  audience varchar(30) NOT NULL
    CHECK (audience IN ('ALL','PLATFORM','ENTERPRISE','FARM','TRANSPORTER','PROCESSOR','DISTRIBUTOR','RETAILER')),
  severity varchar(20) NOT NULL CHECK (severity IN ('INFO','WARNING','MAINTENANCE')),
  starts_at timestamptz(6) NOT NULL,
  ends_at timestamptz(6) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','WITHDRAWN')),
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  withdrawn_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  withdrawn_at timestamptz(6),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL))
);
CREATE INDEX ix_system_notice_active ON system_notice(status, starts_at, ends_at);

CREATE SEQUENCE support_ticket_seq START 1;
CREATE TABLE support_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  category varchar(30) NOT NULL
    CHECK (category IN ('ACCOUNT','BILLING','TECHNICAL','TRACEABILITY','BLOCKCHAIN','PROCESSING','OTHER')),
  priority varchar(20) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  subject varchar(200) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED')),
  assignee_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  due_at timestamptz(6) NOT NULL,
  resolution varchar(2000),
  closed_at timestamptz(6),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE INDEX ix_support_ticket_status ON support_ticket(status, due_at);
CREATE INDEX ix_support_ticket_org ON support_ticket(organization_id, created_at DESC);

CREATE TABLE support_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_ticket(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  author_side varchar(20) NOT NULL CHECK (author_side IN ('ENTERPRISE','PLATFORM')),
  body varchar(4000) NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (NOT internal OR author_side = 'PLATFORM')
);
CREATE INDEX ix_support_message_ticket ON support_message(ticket_id, created_at);
CREATE TRIGGER trg_support_message_append_only BEFORE UPDATE OR DELETE ON support_message
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- Public report from a QR page. Contact data is optional, needs consent and is
-- visible to platform staff only.
CREATE TABLE consumer_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES lot(lot_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  category varchar(30) NOT NULL
    CHECK (category IN ('COUNTERFEIT','WRONG_INFORMATION','QUALITY','SAFETY','EXPIRED','OTHER')),
  description varchar(2000) NOT NULL,
  contact_email varchar(255),
  contact_phone varchar(30),
  consent boolean NOT NULL DEFAULT false,
  source_hash varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ESCALATED','DISMISSED','DUPLICATE')),
  triage_note varchar(1000),
  triaged_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  triaged_at timestamptz(6),
  case_id uuid REFERENCES platform_case(platform_case_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((contact_email IS NULL AND contact_phone IS NULL) OR consent),
  CHECK ((status = 'NEW') = (triaged_at IS NULL))
);
CREATE INDEX ix_consumer_report_status ON consumer_report(status, created_at);
CREATE INDEX ix_consumer_report_rate ON consumer_report(lot_id, source_hash, created_at);

-- Shared reference lists edited by platform administrators.
CREATE TABLE reference_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category varchar(30) NOT NULL
    CHECK (category IN ('UNIT','PRODUCT_CATEGORY','CERTIFICATE_TYPE','LOSS_REASON','PROCESSING_TYPE','TICKET_CATEGORY')),
  code varchar(40) NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,40}$'),
  label varchar(120) NOT NULL,
  description varchar(500),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (category, code)
);
INSERT INTO reference_item(category, code, label, sort_order) VALUES
  ('UNIT','KG','Kilogam',10),('UNIT','TAN','Tấn',20),('UNIT','THUNG','Thùng',30),('UNIT','HOP','Hộp',40),
  ('UNIT','GOI','Gói',50),('UNIT','CHAI','Chai',60),('UNIT','LIT','Lít',70),
  ('PRODUCT_CATEGORY','RAU','Rau ăn lá',10),('PRODUCT_CATEGORY','CU_QUA','Củ, quả',20),('PRODUCT_CATEGORY','TRAI_CAY','Trái cây',30),
  ('PRODUCT_CATEGORY','LUONG_THUC','Lương thực',40),('PRODUCT_CATEGORY','CHE_BIEN','Nông sản chế biến',50),
  ('CERTIFICATE_TYPE','VIETGAP','VietGAP',10),('CERTIFICATE_TYPE','GLOBALGAP','GlobalG.A.P.',20),('CERTIFICATE_TYPE','ORGANIC','Hữu cơ',30),
  ('CERTIFICATE_TYPE','ATTP','Cơ sở đủ điều kiện ATTP',40),('CERTIFICATE_TYPE','HACCP','HACCP',50),('CERTIFICATE_TYPE','ISO22000','ISO 22000',60),
  ('LOSS_REASON','TRIMMING','Cắt tỉa, loại bỏ phần hỏng',10),('LOSS_REASON','MOISTURE','Hao hụt độ ẩm',20),('LOSS_REASON','SPILLAGE','Rơi vãi',30),
  ('LOSS_REASON','QUALITY_REJECT','Loại do chất lượng',40),('LOSS_REASON','SAMPLING','Lấy mẫu kiểm nghiệm',50),('LOSS_REASON','OTHER','Khác',90),
  ('PROCESSING_TYPE','PRELIMINARY','Sơ chế',10),('PROCESSING_TYPE','PACKING','Đóng gói',20),('PROCESSING_TYPE','DRYING','Sấy',30),
  ('PROCESSING_TYPE','FREEZING','Cấp đông',40),('PROCESSING_TYPE','MILLING','Xay xát',50),('PROCESSING_TYPE','JUICE_EXTRACT','Ép, chiết',60),
  ('PROCESSING_TYPE','FERMENTING','Lên men',70),('PROCESSING_TYPE','OTHER','Khác',90),
  ('TICKET_CATEGORY','ACCOUNT','Tài khoản',10),('TICKET_CATEGORY','BILLING','Thanh toán',20),('TICKET_CATEGORY','TECHNICAL','Kỹ thuật',30),
  ('TICKET_CATEGORY','TRACEABILITY','Truy xuất',40),('TICKET_CATEGORY','BLOCKCHAIN','Blockchain',50),('TICKET_CATEGORY','PROCESSING','Chế biến',60),
  ('TICKET_CATEGORY','OTHER','Khác',90);

INSERT INTO platform_setting(key, value, description) VALUES
  ('notifications.enrollmentDecisionEmail', 'true', 'Gửi email kết quả xét duyệt hồ sơ doanh nghiệp'),
  ('notifications.renewalReminderDays', '30', 'Số ngày trước hạn bắt đầu nhắc gia hạn trên tổng quan doanh nghiệp và admin');

-- New two-person operations: capability approval, plan publication, manual
-- payment confirmation, business setting change and QR block.
ALTER TABLE platform_approval DROP CONSTRAINT platform_approval_operation_check;
ALTER TABLE platform_approval ADD CONSTRAINT platform_approval_operation_check
  CHECK (operation IN ('CAPABILITY_GRANT','CREATE_CHAIN_GRANT','SYSTEM_ADMIN_CREATE','CONNECTION_APPROVE','ADMIN_PASSWORD_RESET',
    'CAPABILITY_REQUEST_APPROVE','PLAN_VERSION_PUBLISH','INVOICE_CONFIRM_PAYMENT','SETTING_CHANGE','QR_BLOCK'));
