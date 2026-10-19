-- P1: processor capability, participation model and per-capability review.
-- Additive only: existing organizations, capabilities and history are untouched.
ALTER TYPE organization_type ADD VALUE IF NOT EXISTS 'PROCESSOR';

ALTER TABLE organization ADD COLUMN participation_model varchar(30) NOT NULL DEFAULT 'SINGLE'
  CHECK (participation_model IN ('SINGLE','SUPPLY_CHAIN_ENTERPRISE'));

-- Registered activities may now include processing (text column, enum not used here).
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'enterprise_profile'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%activities%'
  LOOP
    EXECUTE format('ALTER TABLE enterprise_profile DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE enterprise_profile ADD CONSTRAINT ck_enterprise_profile_activities
  CHECK (cardinality(activities) BETWEEN 1 AND 5
    AND activities <@ ARRAY['FARM','TRANSPORTER','PROCESSOR','DISTRIBUTOR','RETAILER']::text[]);

INSERT INTO app_role(code, name, description)
VALUES ('PROCESSOR', 'Nhà chế biến', 'Thành viên doanh nghiệp chế biến, đóng gói nông sản')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION guard_enterprise_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.permissions <@ ARRAY['profile.read','profile.manage','members.read','members.manage','roles.manage','partners.read','partners.manage','catalog.read','catalog.manage','sites.read','sites.manage','vehicles.read','vehicles.manage','production.read','production.write','distribution.read','distribution.write','distribution.sign','trace.read','qr.manage','reports.read','quantity.adjust','cases.read','cases.respond','inventory.manage','quarantine.manage','evidence.read','evidence.manage','materials.read','materials.manage','processing.read','processing.write']::text[]
 THEN RAISE EXCEPTION 'Unknown enterprise permission'; END IF;
 RETURN NEW;
END $$;

-- One reviewable request per registered capability. Approval is recorded here;
-- the capability itself is still created only by an audited activation step.
CREATE TABLE capability_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  code organization_type NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  details jsonb NOT NULL DEFAULT '{}',
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  review_note varchar(1000),
  reviewed_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  reviewed_at timestamptz(6),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((status = 'PENDING') = (reviewed_at IS NULL))
);
CREATE UNIQUE INDEX uq_capability_request_open ON capability_request(organization_id, code)
  WHERE status IN ('PENDING','APPROVED');
CREATE INDEX ix_capability_request_status ON capability_request(status, created_at);

CREATE FUNCTION guard_capability_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Capability review history is append-only'; END IF;
 IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.code IS DISTINCT FROM OLD.code
   OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.version <> OLD.version + 1
   OR NOT ((OLD.status = 'PENDING' AND NEW.status IN ('APPROVED','REJECTED','WITHDRAWN'))
        OR (OLD.status = 'APPROVED' AND NEW.status = 'WITHDRAWN'))
 THEN RAISE EXCEPTION 'Invalid capability request transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_capability_request_guard BEFORE UPDATE OR DELETE ON capability_request
  FOR EACH ROW EXECUTE FUNCTION guard_capability_request();

-- Versioned business parameters edited by platform administrators. Secrets,
-- signing material and ledger configuration never live here.
CREATE TABLE platform_setting (
  key varchar(80) PRIMARY KEY,
  value jsonb NOT NULL,
  description varchar(500) NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);
INSERT INTO platform_setting(key, value, description) VALUES
  ('billing.graceDays', '15', 'Số ngày ân hạn sau khi gói hết hạn trước khi chặn tạo mới'),
  ('processing.massBalanceTolerancePercent', '0', 'Sai lệch cân bằng khối lượng tối đa (%) khi hoàn tất lệnh chế biến'),
  ('consumerReports.maxPerHour', '5', 'Số báo cáo vi phạm tối đa mỗi giờ cho một mã QR từ cùng một nguồn'),
  ('enrollment.reviewSlaHours', '48', 'Thời hạn xử lý hồ sơ chờ duyệt (giờ) hiển thị trong hộp việc admin'),
  ('support.reviewSlaHours', '24', 'Thời hạn phản hồi yêu cầu hỗ trợ (giờ)');
