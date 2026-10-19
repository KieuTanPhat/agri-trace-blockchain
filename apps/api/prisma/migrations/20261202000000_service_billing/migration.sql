-- P2: versioned service catalog, subscriptions, invoices and payments.
-- Payments stay simulated or manually confirmed; SePay can attach later as a
-- provider without changing invoice history.
CREATE TABLE service_plan (
  code varchar(30) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  name varchar(120) NOT NULL,
  audience varchar(30) NOT NULL CHECK (audience IN ('PRODUCER','SUPPLY_CHAIN_ENTERPRISE')),
  description varchar(1000),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE service_plan_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code varchar(30) NOT NULL REFERENCES service_plan(code) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  setup_fee bigint NOT NULL CHECK (setup_fee >= 0),
  annual_fee bigint NOT NULL CHECK (annual_fee >= 0),
  term_months integer NOT NULL DEFAULT 12 CHECK (term_months BETWEEN 1 AND 60),
  limits jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  note varchar(1000),
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  published_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  published_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (plan_code, version),
  CHECK (jsonb_typeof(limits) = 'object'),
  CHECK ((status = 'DRAFT') = (published_at IS NULL))
);
CREATE UNIQUE INDEX uq_service_plan_version_published ON service_plan_version(plan_code)
  WHERE status = 'PUBLISHED';

-- Quotations reference a published version; its price and limits never change.
CREATE FUNCTION guard_service_plan_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Published plan versions are retained'; END IF;
   RETURN OLD;
 END IF;
 IF OLD.status <> 'DRAFT' AND (
   ROW(NEW.plan_code, NEW.version, NEW.setup_fee, NEW.annual_fee, NEW.term_months, NEW.limits, NEW.published_at)
     IS DISTINCT FROM ROW(OLD.plan_code, OLD.version, OLD.setup_fee, OLD.annual_fee, OLD.term_months, OLD.limits, OLD.published_at)
   OR NOT (OLD.status = NEW.status OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')))
 THEN RAISE EXCEPTION 'Published plan versions are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_service_plan_version_guard BEFORE UPDATE OR DELETE ON service_plan_version
  FOR EACH ROW EXECUTE FUNCTION guard_service_plan_version();

CREATE TABLE subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES service_plan_version(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK (status IN ('PENDING_PAYMENT','ACTIVE','CANCELLED')),
  starts_at timestamptz(6),
  ends_at timestamptz(6),
  source_order_id uuid UNIQUE REFERENCES enterprise_service_order(id) ON DELETE RESTRICT,
  cancelled_at timestamptz(6),
  cancel_reason varchar(1000),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (status <> 'ACTIVE' OR (starts_at IS NOT NULL AND ends_at > starts_at)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_subscription_open ON subscription(organization_id)
  WHERE status IN ('PENDING_PAYMENT','ACTIVE');

CREATE SEQUENCE invoice_number_seq START 1;
CREATE TABLE invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number varchar(30) NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES subscription(id) ON DELETE RESTRICT,
  plan_version_id uuid REFERENCES service_plan_version(id) ON DELETE RESTRICT,
  kind varchar(20) NOT NULL CHECK (kind IN ('INITIAL','RENEWAL','ADDON')),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  amount bigint NOT NULL CHECK (amount >= 0),
  currency varchar(3) NOT NULL DEFAULT 'VND',
  status varchar(20) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','PAID','VOID')),
  issued_at timestamptz(6) NOT NULL DEFAULT now(),
  due_at timestamptz(6) NOT NULL,
  paid_at timestamptz(6),
  provider varchar(20) CHECK (provider IN ('SIMULATION','MANUAL','SEPAY')),
  provider_reference varchar(120),
  simulated boolean NOT NULL DEFAULT false,
  void_reason varchar(1000),
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK ((status = 'PAID') = (paid_at IS NOT NULL AND provider IS NOT NULL)),
  CHECK ((status = 'VOID') = (void_reason IS NOT NULL))
);
CREATE INDEX ix_invoice_org ON invoice(organization_id, issued_at DESC);
CREATE INDEX ix_invoice_status ON invoice(status, due_at);
CREATE UNIQUE INDEX uq_invoice_provider_reference ON invoice(provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE FUNCTION guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Invoices are retained'; END IF;
 IF ROW(NEW.number, NEW.organization_id, NEW.subscription_id, NEW.plan_version_id, NEW.kind, NEW.lines, NEW.amount, NEW.currency, NEW.issued_at)
   IS DISTINCT FROM ROW(OLD.number, OLD.organization_id, OLD.subscription_id, OLD.plan_version_id, OLD.kind, OLD.lines, OLD.amount, OLD.currency, OLD.issued_at)
   OR NEW.version <> OLD.version + 1
   OR NOT (OLD.status = 'ISSUED' AND NEW.status IN ('PAID','VOID'))
 THEN RAISE EXCEPTION 'Invalid invoice transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_invoice_guard BEFORE UPDATE OR DELETE ON invoice
  FOR EACH ROW EXECUTE FUNCTION guard_invoice();

CREATE TABLE invoice_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoice(id) ON DELETE RESTRICT,
  provider varchar(20) NOT NULL CHECK (provider IN ('SIMULATION','MANUAL','SEPAY')),
  amount bigint NOT NULL CHECK (amount >= 0),
  reference varchar(120),
  recorded_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  note varchar(1000),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX ix_invoice_payment_invoice ON invoice_payment(invoice_id);
CREATE FUNCTION guard_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER trg_invoice_payment_append_only BEFORE UPDATE OR DELETE ON invoice_payment
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- Initial catalog, mirroring the iCheck-referenced prices already offered.
INSERT INTO service_plan(code, name, audience, description, sort_order) VALUES
  ('TRACE_5', 'Truy xuất 5 sản phẩm', 'PRODUCER', 'Nhà sản xuất/HTX quy mô nhỏ', 10),
  ('TRACE_10', 'Truy xuất 10 sản phẩm', 'PRODUCER', 'Nhà sản xuất/HTX quy mô vừa', 20),
  ('TRACE_20', 'Truy xuất 20 sản phẩm', 'PRODUCER', 'Nhà sản xuất/HTX nhiều sản phẩm', 30),
  ('CHAIN_PRO', 'Doanh nghiệp chuỗi cung ứng', 'SUPPLY_CHAIN_ENTERPRISE', 'Một tổ chức quản lý nhiều năng lực trong chuỗi', 40);
INSERT INTO service_plan_version(plan_code, version, setup_fee, annual_fee, limits, status, published_at, note) VALUES
  ('TRACE_5', 1, 5000000, 3500000, '{"products":5,"chains":1,"members":10,"qrLabels":10000}', 'PUBLISHED', now(), 'Phiên bản khởi tạo'),
  ('TRACE_10', 1, 5000000, 5500000, '{"products":10,"chains":2,"members":20,"qrLabels":20000}', 'PUBLISHED', now(), 'Phiên bản khởi tạo'),
  ('TRACE_20', 1, 5000000, 9000000, '{"products":20,"chains":3,"members":40,"qrLabels":50000}', 'PUBLISHED', now(), 'Phiên bản khởi tạo'),
  ('CHAIN_PRO', 1, 10000000, 18000000, '{"products":50,"chains":10,"members":100,"qrLabels":200000}', 'PUBLISHED', now(), 'Phiên bản khởi tạo');

INSERT INTO platform_setting(key, value, description) VALUES
  ('billing.participantLimits', '{"products":30,"chains":0,"members":30,"qrLabels":20000}',
   'Hạn mức miễn phí cho tổ chức tham gia chuỗi (vận chuyển, chế biến, phân phối, bán lẻ)'),
  ('billing.invoiceDueDays', '15', 'Số ngày từ khi phát hành tới hạn thanh toán hóa đơn');

-- Existing settled orders keep working: give them an active subscription and a
-- paid, explicitly simulated invoice. No real payment is implied.
INSERT INTO subscription(organization_id, plan_version_id, status, starts_at, ends_at, source_order_id)
SELECT e.organization_id, v.id, 'ACTIVE', o.paid_at, o.paid_at + interval '12 months', o.id
FROM enterprise_service_order o
JOIN enterprise_enrollment e ON e.id = o.enrollment_id
JOIN service_plan_version v ON v.plan_code = o.plan_code AND v.version = 1
WHERE o.status = 'PAID_SIMULATED' AND o.paid_at IS NOT NULL;
INSERT INTO invoice(number, organization_id, subscription_id, plan_version_id, kind, lines, amount, status, issued_at, due_at, paid_at, provider, simulated)
SELECT 'AGT-' || to_char(o.paid_at, 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
  s.organization_id, s.id, s.plan_version_id, 'INITIAL',
  jsonb_build_array(jsonb_build_object('description', 'Gói ' || o.plan_code || ' (đơn dịch vụ đã thanh toán mô phỏng)', 'amount', o.amount)),
  o.amount, 'PAID', o.accepted_at, o.paid_at, o.paid_at, 'SIMULATION', true
FROM subscription s JOIN enterprise_service_order o ON o.id = s.source_order_id;

-- Supply-chain enterprises buy CHAIN_PRO through the same contract snapshot.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'enterprise_service_order'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%plan_code%'
  LOOP
    EXECUTE format('ALTER TABLE enterprise_service_order DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE enterprise_service_order ADD CONSTRAINT ck_enterprise_service_order_plan
  CHECK (plan_code ~ '^[A-Z][A-Z0-9_]{1,29}$');
