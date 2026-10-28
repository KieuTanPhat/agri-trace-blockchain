-- Existing enrollments retain their recorded admission. All new registrations
-- opt into the reviewed contract and settlement gate at application creation.
ALTER TABLE enterprise_enrollment ADD COLUMN activation_required boolean NOT NULL DEFAULT false;
ALTER TABLE enterprise_profile ADD COLUMN province_code varchar(2), ADD COLUMN ward_code varchar(5), ADD COLUMN ward varchar(100);
ALTER TABLE enterprise_profile ADD CONSTRAINT enterprise_address_codes CHECK (
  (province_code IS NULL AND ward_code IS NULL AND ward IS NULL) OR
  (province_code ~ '^[0-9]{2}$' AND ward_code ~ '^[0-9]{5}$' AND length(ward)>1));

CREATE TABLE enterprise_service_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL UNIQUE REFERENCES enterprise_enrollment(id) ON DELETE RESTRICT,
  plan_code varchar(30) NOT NULL CHECK (plan_code IN ('TRACE_5','TRACE_10','TRACE_20')),
  hosting_mode varchar(30) NOT NULL CHECK (hosting_mode IN ('MANAGED_ORG','SELF_MANAGED_ORG')),
  billing_email varchar(255) NOT NULL, billing_name varchar(255) NOT NULL, billing_address varchar(500) NOT NULL,
  amount integer NOT NULL CHECK (amount>0), quotation jsonb NOT NULL,
  contract_text text NOT NULL, contract_digest varchar(64) NOT NULL CHECK (contract_digest ~ '^[a-f0-9]{64}$'),
  status varchar(30) NOT NULL DEFAULT 'AWAITING_PAYMENT' CHECK (status IN ('AWAITING_PAYMENT','PAID_SIMULATED')),
  accepted_at timestamptz NOT NULL, paid_at timestamptz, version integer NOT NULL DEFAULT 0 CHECK(version>=0), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='AWAITING_PAYMENT' AND paid_at IS NULL) OR (status='PAID_SIMULATED' AND paid_at IS NOT NULL))
);
CREATE TABLE enterprise_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL REFERENCES enterprise_enrollment(id) ON DELETE RESTRICT,
  kind varchar(30) NOT NULL CHECK (kind IN ('APPROVED','REJECTED','CONTRACT')), recipient varchar(255) NOT NULL,
  subject varchar(255) NOT NULL, text text NOT NULL, attachment text,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT')), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_expires_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(enrollment_id,kind), CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK ((status='SENT')=(sent_at IS NOT NULL))
);
CREATE INDEX enterprise_mail_status_next_attempt_at_idx ON enterprise_mail(status,next_attempt_at);

CREATE FUNCTION guard_enterprise_service_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Service contract history cannot be deleted'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM enterprise_enrollment WHERE id=NEW.enrollment_id AND status='APPROVED')
      OR NEW.status<>'AWAITING_PAYMENT' OR NEW.version<>0 THEN RAISE EXCEPTION 'A contract requires an approved enrollment'; END IF;
  ELSE
    IF ROW(NEW.id,NEW.enrollment_id,NEW.plan_code,NEW.hosting_mode,NEW.billing_email,NEW.billing_name,NEW.billing_address,NEW.amount,NEW.quotation,NEW.contract_text,NEW.contract_digest,NEW.accepted_at,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.enrollment_id,OLD.plan_code,OLD.hosting_mode,OLD.billing_email,OLD.billing_name,OLD.billing_address,OLD.amount,OLD.quotation,OLD.contract_text,OLD.contract_digest,OLD.accepted_at,OLD.created_at)
      OR OLD.status<>'AWAITING_PAYMENT' OR NEW.status<>'PAID_SIMULATED' OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'Contract snapshot is immutable; settlement advances once';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enterprise_service_order_guard BEFORE INSERT OR UPDATE OR DELETE ON enterprise_service_order FOR EACH ROW EXECUTE FUNCTION guard_enterprise_service_order();

CREATE FUNCTION guard_enterprise_activation_flag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.activation_required IS DISTINCT FROM OLD.activation_required THEN RAISE EXCEPTION 'Registration activation policy is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enterprise_activation_flag BEFORE UPDATE ON enterprise_enrollment FOR EACH ROW EXECUTE FUNCTION guard_enterprise_activation_flag();

CREATE FUNCTION check_enterprise_paid_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid;
BEGIN
  org:=NEW.organization_id;
  IF NOT EXISTS(SELECT 1 FROM organization_capability WHERE organization_id=org AND revoked_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM scoped_role_grant WHERE organization_id=org AND revoked_at IS NULL) THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM enterprise_enrollment e WHERE e.organization_id=org AND e.activation_required
    AND (e.status<>'APPROVED' OR NOT EXISTS(SELECT 1 FROM enterprise_service_order s WHERE s.enrollment_id=e.id AND s.status='PAID_SIMULATED')))
    THEN RAISE EXCEPTION 'Business authority requires an approved settled service contract'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_capability_paid_enterprise AFTER INSERT OR UPDATE ON organization_capability DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_enterprise_paid_authority();
CREATE CONSTRAINT TRIGGER trg_grant_paid_enterprise AFTER INSERT OR UPDATE ON scoped_role_grant DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_enterprise_paid_authority();
