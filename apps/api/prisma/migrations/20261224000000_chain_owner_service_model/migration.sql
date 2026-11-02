-- ADR-005: participation status, chain-owner plans, farm ledger, cross-chain
-- processing inputs, supplier trust and product approval. Fresh-install line:
-- simulated history is reset rather than rewritten. Historical migrations stay
-- immutable; no event, hash, proof or binding is changed here.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM enterprise_enrollment) OR EXISTS(SELECT 1 FROM enterprise_service_order)
 OR EXISTS(SELECT 1 FROM subscription) OR EXISTS(SELECT 1 FROM trace_event)
 THEN RAISE EXCEPTION 'Chain-owner service model requires a fresh database; existing history must not be rewritten'; END IF;
END $$;

-- 1. Organizations: only enterprises and cooperatives; MEMBER or CHAIN_OWNER.
ALTER TABLE organization DROP COLUMN participation_model;
ALTER TABLE organization ADD COLUMN participation_status varchar(20) NOT NULL DEFAULT 'MEMBER'
  CHECK (participation_status IN ('MEMBER','CHAIN_OWNER'));
ALTER TABLE enterprise_profile DROP CONSTRAINT enterprise_profile_legal_form_check;
ALTER TABLE enterprise_profile ADD CONSTRAINT enterprise_profile_legal_form_check
  CHECK (legal_form IN ('ENTERPRISE','COOPERATIVE'));

-- 2. Plans by scale. Old audience-based versions are retired, never edited.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'service_plan'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%audience%'
  LOOP
    EXECUTE format('ALTER TABLE service_plan DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE service_plan DROP COLUMN audience;
UPDATE service_plan_version SET status = 'RETIRED' WHERE status = 'PUBLISHED';
UPDATE service_plan SET status = 'RETIRED';
INSERT INTO service_plan(code, name, description, sort_order) VALUES
  ('OWNER_START', 'Khởi đầu', 'Chủ chuỗi quy mô nhỏ: một dòng sản phẩm', 10),
  ('OWNER_GROWTH', 'Tăng trưởng', 'Chủ chuỗi quy mô vừa', 20),
  ('OWNER_SCALE', 'Mở rộng', 'Chủ chuỗi nhiều dòng sản phẩm', 30),
  ('OWNER_ENTERPRISE', 'Doanh nghiệp', 'Chủ chuỗi lớn, nhiều chuỗi và đối tác', 40);
INSERT INTO service_plan_version(plan_code, version, setup_fee, annual_fee, limits, status, published_at, note) VALUES
  ('OWNER_START', 1, 5000000, 3500000, '{"products":5,"chains":1,"partners":10,"members":10}', 'PUBLISHED', now(), 'Phiên bản khởi tạo theo quy mô'),
  ('OWNER_GROWTH', 1, 5000000, 5500000, '{"products":10,"chains":2,"partners":20,"members":20}', 'PUBLISHED', now(), 'Phiên bản khởi tạo theo quy mô'),
  ('OWNER_SCALE', 1, 5000000, 9000000, '{"products":20,"chains":3,"partners":40,"members":40}', 'PUBLISHED', now(), 'Phiên bản khởi tạo theo quy mô'),
  ('OWNER_ENTERPRISE', 1, 10000000, 18000000, '{"products":50,"chains":10,"partners":100,"members":100}', 'PUBLISHED', now(), 'Phiên bản khởi tạo theo quy mô');
UPDATE platform_setting SET value = '{"products":30,"chains":0,"partners":0,"members":30}',
  description = 'Hạn mức của thành viên miễn phí (không tạo chuỗi, không mời đối tác)'
  WHERE key = 'billing.participantLimits';
INSERT INTO platform_setting(key, value, description) VALUES
  ('billing.farmLedgerLimits', '{"cycles":10,"lots":100}',
   'Hạn mức mỗi năm của sổ ghi nông trại miễn phí');

-- 3. VAT-shaped invoices (still simulated). Columns are fixed at issue.
ALTER TABLE invoice ADD COLUMN template_code varchar(11);
ALTER TABLE invoice ADD COLUMN series varchar(10);
ALTER TABLE invoice ADD COLUMN seller_name varchar(255);
ALTER TABLE invoice ADD COLUMN seller_tax_code varchar(20);
ALTER TABLE invoice ADD COLUMN buyer_name varchar(255);
ALTER TABLE invoice ADD COLUMN buyer_tax_code varchar(20);
ALTER TABLE invoice ADD COLUMN buyer_address varchar(500);
ALTER TABLE invoice ADD COLUMN subtotal bigint CHECK (subtotal IS NULL OR subtotal >= 0);
ALTER TABLE invoice ADD COLUMN vat_rate numeric(5,2) CHECK (vat_rate IS NULL OR vat_rate BETWEEN 0 AND 100);
ALTER TABLE invoice ADD COLUMN vat_amount bigint CHECK (vat_amount IS NULL OR vat_amount >= 0);
ALTER TABLE invoice ADD CONSTRAINT ck_invoice_vat_total
  CHECK (subtotal IS NULL OR vat_amount IS NULL OR amount = subtotal + vat_amount);
CREATE FUNCTION guard_invoice_vat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.template_code, NEW.series, NEW.seller_name, NEW.seller_tax_code, NEW.buyer_name,
        NEW.buyer_tax_code, NEW.buyer_address, NEW.subtotal, NEW.vat_rate, NEW.vat_amount)
   IS DISTINCT FROM ROW(OLD.template_code, OLD.series, OLD.seller_name, OLD.seller_tax_code, OLD.buyer_name,
        OLD.buyer_tax_code, OLD.buyer_address, OLD.subtotal, OLD.vat_rate, OLD.vat_amount)
 THEN RAISE EXCEPTION 'Invoice tax details are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_invoice_vat_guard BEFORE UPDATE ON invoice
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_vat();

-- 4. Membership closing: an owner stops new handovers to a partner; the partner
-- is suspended only once it holds nothing. ACTIVE -> ACTIVE is allowed solely to
-- set or clear closing_at.
ALTER TABLE chain_membership ADD COLUMN closing_at timestamptz(6);
CREATE OR REPLACE FUNCTION fn_guard_chain_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Membership history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    ROW(NEW.membership_id, NEW.chain_id, NEW.organization_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.membership_id, OLD.chain_id, OLD.organization_id, OLD.created_at)
    OR NEW.version <> OLD.version + 1
    OR NEW.invitation_revision <> OLD.invitation_revision + CASE WHEN NEW.status = 'INVITED' THEN 1 ELSE 0 END
    OR NOT ((OLD.status = 'INVITED' AND NEW.status IN ('ACTIVE', 'SUSPENDED', 'REVOKED'))
      OR (OLD.status = 'ACTIVE' AND NEW.status IN ('SUSPENDED', 'REVOKED'))
      OR (OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE' AND NEW.closing_at IS DISTINCT FROM OLD.closing_at)
      OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('INVITED', 'REVOKED'))
      OR (OLD.status = 'REVOKED' AND NEW.status = 'INVITED'))
  ) THEN
    RAISE EXCEPTION 'Invalid membership transition' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> 'ACTIVE' THEN NEW.closing_at := NULL; END IF;
  IF NEW.organization_id = (SELECT owner_organization_id FROM supply_chain WHERE chain_id = NEW.chain_id)
    AND (NEW.status <> 'ACTIVE' OR NEW.closing_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Owner membership must remain active' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- 5. One owner per finished product; brand page needs platform approval.
ALTER TABLE product ADD COLUMN approval_status varchar(20) NOT NULL DEFAULT 'NONE'
  CHECK (approval_status IN ('NONE','PENDING','APPROVED','REJECTED'));
ALTER TABLE product ADD COLUMN approval_requested_at timestamptz(6);
ALTER TABLE product ADD COLUMN approved_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT;
ALTER TABLE product ADD COLUMN approved_at timestamptz(6);
ALTER TABLE product ADD COLUMN approval_note varchar(1000);
ALTER TABLE product ADD CONSTRAINT ck_product_approval
  CHECK ((approval_status = 'APPROVED') = (approved_at IS NOT NULL AND approved_by IS NOT NULL)
    AND (approval_status <> 'NONE' OR approval_requested_at IS NULL));
CREATE FUNCTION fn_chain_products_owned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.product_ids) AS p(id)
    LEFT JOIN product pr ON pr.product_id = p.id
    WHERE pr.product_id IS NULL OR pr.organization_id IS DISTINCT FROM NEW.owner_organization_id) THEN
    RAISE EXCEPTION 'Chain products must belong to the chain owner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_chain_products_owned BEFORE INSERT OR UPDATE OF product_ids, owner_organization_id
  ON supply_chain FOR EACH ROW EXECUTE FUNCTION fn_chain_products_owned();

-- 6. Supplier directory on external receipts (the private address book) and
-- accepted document kinds. Trust level is derived, never stored.
ALTER TABLE material_receipt ADD COLUMN supplier_id uuid REFERENCES enterprise_external_partner(id) ON DELETE RESTRICT;
ALTER TABLE material_receipt ADD COLUMN growing_area_code varchar(60);
ALTER TABLE material_receipt ADD CONSTRAINT ck_material_receipt_supplier
  CHECK (source <> 'EXTERNAL' OR supplier_id IS NOT NULL);
CREATE OR REPLACE FUNCTION guard_material_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Material receipts are retained'; END IF;
 IF ROW(NEW.id, NEW.code, NEW.organization_id, NEW.site_id, NEW.source, NEW.transfer_id, NEW.lot_id,
        NEW.material_name, NEW.supplier_name, NEW.supplier_id, NEW.growing_area_code, NEW.document_no,
        NEW.received_at, NEW.quantity, NEW.unit, NEW.expiry_date, NEW.note, NEW.created_by, NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id, OLD.code, OLD.organization_id, OLD.site_id, OLD.source, OLD.transfer_id, OLD.lot_id,
        OLD.material_name, OLD.supplier_name, OLD.supplier_id, OLD.growing_area_code, OLD.document_no,
        OLD.received_at, OLD.quantity, OLD.unit, OLD.expiry_date, OLD.note, OLD.created_by, OLD.created_at)
   OR NEW.version <> OLD.version + 1 OR NEW.consumed < OLD.consumed
 THEN RAISE EXCEPTION 'Material receipts are immutable'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_kind_chk;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_kind_chk CHECK (kind IN (
  'OTHER','PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE',
  'PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE',
  'SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','LOT_DOCUMENT','SITE_IMAGE',
  'BUSINESS_LICENSE','TRANSFER_IMAGE','HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO',
  'MEMBER_AVATAR','MEMBER_DOCUMENT','CHAIN_IMAGE','QUARANTINE_IMAGE',
  'PARTNERSHIP_EVIDENCE','RECEIPT_DOCUMENT','PROCESSING_IMAGE',
  'INVOICE','PURCHASE_LIST','WEIGHING_SLIP','LAB_TEST','PRODUCT_DECLARATION'));

-- Supplier confirmation without an account: one-time token, hash stored only.
CREATE TABLE supplier_confirmation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES material_receipt(id) ON DELETE RESTRICT,
  token_hash varchar(64) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','DECLINED')),
  expires_at timestamptz(6) NOT NULL,
  responded_at timestamptz(6),
  responder_name varchar(120),
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 0,
  CHECK ((status = 'PENDING') = (responded_at IS NULL))
);
CREATE UNIQUE INDEX uq_supplier_confirmation_open ON supplier_confirmation(receipt_id) WHERE status = 'PENDING';
CREATE INDEX ix_supplier_confirmation_receipt ON supplier_confirmation(receipt_id);
CREATE FUNCTION guard_supplier_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Supplier confirmations are retained'; END IF;
 IF ROW(NEW.id, NEW.receipt_id, NEW.token_hash, NEW.expires_at, NEW.created_by, NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id, OLD.receipt_id, OLD.token_hash, OLD.expires_at, OLD.created_by, OLD.created_at)
   OR NEW.version <> OLD.version + 1
   OR NOT (OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED','DECLINED'))
 THEN RAISE EXCEPTION 'Invalid supplier confirmation transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_supplier_confirmation_guard BEFORE UPDATE OR DELETE ON supplier_confirmation
  FOR EACH ROW EXECUTE FUNCTION guard_supplier_confirmation();

-- 7. Partner invitations for organizations without an account. Hash only;
-- the invitation mail carries the link and belongs to no enrollment yet.
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_kind_check;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_kind_check
  CHECK (kind IN ('APPROVED','REJECTED','CONTRACT','REGISTRATION_OTP','CREDENTIALS','ACCOUNT_CREDENTIALS','PARTNER_INVITE'));
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_subject_scope;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_subject_scope CHECK (
  (kind = 'REGISTRATION_OTP' AND enrollment_id IS NULL AND verification_id IS NOT NULL AND user_id IS NULL)
  OR (kind = 'ACCOUNT_CREDENTIALS' AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NOT NULL)
  OR (kind = 'PARTNER_INVITE' AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NULL)
  OR (kind NOT IN ('REGISTRATION_OTP','ACCOUNT_CREDENTIALS','PARTNER_INVITE') AND enrollment_id IS NOT NULL AND verification_id IS NULL AND user_id IS NULL));
CREATE TABLE partner_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES supply_chain(chain_id) ON DELETE RESTRICT,
  inviter_organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  email varchar(255) NOT NULL,
  organization_name varchar(255) NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REVOKED')),
  expires_at timestamptz(6) NOT NULL,
  accepted_organization_id uuid REFERENCES organization(organization_id) ON DELETE RESTRICT,
  accepted_at timestamptz(6),
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 0,
  CHECK ((status = 'ACCEPTED') = (accepted_organization_id IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE INDEX ix_partner_invitation_chain ON partner_invitation(chain_id, status);
CREATE FUNCTION guard_partner_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Partner invitations are retained'; END IF;
 IF ROW(NEW.id, NEW.chain_id, NEW.inviter_organization_id, NEW.email, NEW.organization_name, NEW.token_hash,
        NEW.expires_at, NEW.created_by, NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id, OLD.chain_id, OLD.inviter_organization_id, OLD.email, OLD.organization_name,
        OLD.token_hash, OLD.expires_at, OLD.created_by, OLD.created_at)
   OR NEW.version <> OLD.version + 1
   OR NOT (OLD.status = 'PENDING' AND NEW.status IN ('ACCEPTED','REVOKED'))
 THEN RAISE EXCEPTION 'Invalid partner invitation transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_partner_invitation_guard BEFORE UPDATE OR DELETE ON partner_invitation
  FOR EACH ROW EXECUTE FUNCTION guard_partner_invitation();

-- Recall proposals are private notes from a partner to the chain owner.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'trace_notice'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE trace_notice DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE trace_notice ADD CONSTRAINT trace_notice_kind_check
  CHECK (kind IN ('WARNING','RECALL','RECALL_PROPOSAL'));

-- 8. Cross-chain processing inputs. A run that consumes a lot of another chain
-- keeps the binding pinned at planning and never gains an origin cycle; the
-- consumption event stays on the source chain and is linked here by hash.
CREATE TABLE processing_cross_chain_input (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES processing_run(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES lot(lot_id) ON DELETE RESTRICT,
  source_chain_id uuid NOT NULL REFERENCES supply_chain(chain_id) ON DELETE RESTRICT,
  event_id uuid NOT NULL UNIQUE REFERENCES trace_event(event_id) ON DELETE RESTRICT,
  data_hash varchar(64) NOT NULL,
  binding_digest varchar(64) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (run_id, lot_id)
);
CREATE TRIGGER trg_processing_cross_chain_input_append_only BEFORE UPDATE OR DELETE ON processing_cross_chain_input
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE FUNCTION guard_pinned_processing_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.binding_digest IS NOT NULL AND NEW.origin_cycle_id IS DISTINCT FROM OLD.origin_cycle_id THEN
   RAISE EXCEPTION 'A pinned processing run never gains an origin cycle';
 END IF;
 IF OLD.origin_cycle_id IS NOT NULL AND NEW.origin_cycle_id IS DISTINCT FROM OLD.origin_cycle_id THEN
   RAISE EXCEPTION 'Processing origin cycle is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_pinned_processing_origin BEFORE UPDATE OF origin_cycle_id ON processing_run
  FOR EACH ROW EXECUTE FUNCTION guard_pinned_processing_origin();
