-- Fresh-install topology change. Never rewrite a binding, hash, audit or proof.
-- Historical migrations remain immutable. Provision a separate empty database.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM fabric_network_binding) OR EXISTS(SELECT 1 FROM enterprise_connection)
 OR EXISTS(SELECT 1 FROM enterprise_msp_allocation) OR EXISTS(SELECT 1 FROM enterprise_enrollment)
 OR EXISTS(SELECT 1 FROM enterprise_service_order) OR EXISTS(SELECT 1 FROM trace_event)
 THEN RAISE EXCEPTION 'Platform Fabric topology requires a fresh database; existing history must not be rewritten'; END IF;
END $$;
DROP TABLE enterprise_connection;
DROP TABLE enterprise_msp_allocation;
DROP FUNCTION guard_enterprise_onboarding();
ALTER TABLE enterprise_enrollment DROP COLUMN hosting_mode;
ALTER TABLE enterprise_service_order DROP COLUMN hosting_mode;
ALTER TYPE ledger_profile RENAME TO retired_ledger_profile;
CREATE TYPE ledger_profile AS ENUM ('SERVICE');
ALTER TABLE fabric_network_binding ALTER COLUMN profile TYPE ledger_profile USING profile::text::ledger_profile;
DROP TYPE retired_ledger_profile;

CREATE OR REPLACE FUNCTION guard_enterprise_enrollment_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Enrollment history is immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR (NEW.id,NEW.organization_id,NEW.registration_digest,NEW.business_id) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.registration_digest,OLD.business_id)
 THEN RAISE EXCEPTION 'Enrollment identity or version mismatch'; END IF;
 IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
  IF OLD.status='APPROVED' AND NEW.status='APPROVED'
   AND (NEW.service_activated_at,NEW.service_activated_by,NEW.service_activation_reason,NEW.reviewed_by,NEW.review_note)
    IS NOT DISTINCT FROM (OLD.service_activated_at,OLD.service_activated_by,OLD.service_activation_reason,OLD.reviewed_by,OLD.review_note)
   AND EXISTS(SELECT 1 FROM enterprise_ownership_transfer t WHERE t.organization_id=OLD.organization_id AND t.from_user_id=OLD.owner_id
    AND t.to_user_id=NEW.owner_id AND t.status='ACCEPTED' AND t.resolved_at=now() AND t.enrollment_version=OLD.version)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Enrollment owner changes require an accepted ownership transfer';
 END IF;
 IF OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED') AND NEW.service_activated_at IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='APPROVED' AND NEW.status='APPROVED' AND OLD.service_activated_at IS NULL AND NEW.service_activated_at IS NOT NULL THEN RETURN NEW; END IF;
 IF OLD.status='REJECTED' AND NEW.status='PENDING_REVIEW' AND NEW.service_activated_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.review_note IS NULL
 AND EXISTS(SELECT 1 FROM enterprise_profile_amendment a JOIN enterprise_profile p ON p.organization_id=a.organization_id WHERE a.organization_id=OLD.organization_id AND a.status='APPROVED' AND a.profile_version=p.version-1)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Invalid enrollment transition';
END $$;

CREATE OR REPLACE FUNCTION guard_enterprise_service_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Service contract history cannot be deleted'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM enterprise_enrollment WHERE id=NEW.enrollment_id AND status='APPROVED')
      OR NEW.status<>'AWAITING_PAYMENT' OR NEW.version<>0 THEN RAISE EXCEPTION 'A contract requires an approved enrollment'; END IF;
  ELSE
    IF ROW(NEW.id,NEW.enrollment_id,NEW.plan_code,NEW.billing_email,NEW.billing_name,NEW.billing_address,NEW.amount,NEW.quotation,NEW.contract_text,NEW.contract_digest,NEW.accepted_at,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.enrollment_id,OLD.plan_code,OLD.billing_email,OLD.billing_name,OLD.billing_address,OLD.amount,OLD.quotation,OLD.contract_text,OLD.contract_digest,OLD.accepted_at,OLD.created_at)
      OR OLD.status<>'AWAITING_PAYMENT' OR NEW.status<>'PAID_SIMULATED' OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'Contract snapshot is immutable; settlement advances once';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE ledger_provisioning_job (
 chain_id uuid PRIMARY KEY REFERENCES supply_chain(chain_id) ON DELETE RESTRICT,
 binding_digest varchar(64) REFERENCES fabric_network_binding(digest) ON DELETE RESTRICT,
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','COMPLETED')),
 lease_token uuid, lease_expires_at timestamptz(6), next_attempt_at timestamptz(6),
 last_error varchar(1000), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 created_at timestamptz(6) NOT NULL DEFAULT now(), completed_at timestamptz(6),
 CHECK((status='COMPLETED')=(completed_at IS NOT NULL)),
 CHECK(status<>'COMPLETED' OR binding_digest IS NOT NULL)
);
CREATE INDEX ledger_provisioning_job_status_next_attempt_at_idx ON ledger_provisioning_job(status,next_attempt_at);
CREATE FUNCTION enqueue_platform_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO ledger_provisioning_job(chain_id) VALUES(NEW.chain_id);
 RETURN NEW;
END $$;
CREATE TRIGGER enqueue_platform_ledger AFTER INSERT ON supply_chain FOR EACH ROW EXECUTE FUNCTION enqueue_platform_ledger();
CREATE FUNCTION guard_platform_provisioning() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Provisioning history is immutable'; END IF;
 IF (NEW.chain_id,NEW.created_at) IS DISTINCT FROM (OLD.chain_id,OLD.created_at)
 OR (OLD.binding_digest IS NOT NULL AND NEW.binding_digest IS DISTINCT FROM OLD.binding_digest)
 OR OLD.status='COMPLETED' THEN RAISE EXCEPTION 'Provisioning target or completed receipt is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_platform_provisioning BEFORE UPDATE OR DELETE ON ledger_provisioning_job FOR EACH ROW EXECUTE FUNCTION guard_platform_provisioning();
