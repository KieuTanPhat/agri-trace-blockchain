-- Retain every accepted PDF and invoice. Only cancelled orders leave the active slot.
ALTER TABLE enterprise_service_order ADD COLUMN cancelled_at timestamptz(6);
ALTER TABLE enterprise_service_order DROP CONSTRAINT enterprise_service_order_enrollment_id_key;
CREATE UNIQUE INDEX enterprise_service_order_current_enrollment_key ON enterprise_service_order(enrollment_id)
 WHERE status <> 'CANCELLED';
CREATE INDEX enterprise_service_order_enrollment_id_created_at_idx ON enterprise_service_order(enrollment_id,created_at);
ALTER TABLE enterprise_service_order DROP CONSTRAINT enterprise_service_order_status_check;
ALTER TABLE enterprise_service_order DROP CONSTRAINT enterprise_service_order_settlement_check;
ALTER TABLE enterprise_service_order
 ADD CONSTRAINT enterprise_service_order_status_check CHECK(status IN ('AWAITING_PAYMENT','PAID_SIMULATED','PAID','CANCELLED')),
 ADD CONSTRAINT enterprise_service_order_settlement_check CHECK(
  (status IN ('AWAITING_PAYMENT','CANCELLED') AND paid_at IS NULL) OR
  (status IN ('PAID_SIMULATED','PAID') AND paid_at IS NOT NULL)),
 ADD CONSTRAINT enterprise_service_order_cancellation_check CHECK((status='CANCELLED')=(cancelled_at IS NOT NULL));

CREATE OR REPLACE FUNCTION guard_enterprise_service_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Service contract history cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM enterprise_enrollment WHERE id=NEW.enrollment_id AND status='APPROVED')
   OR NEW.contract_pdf IS NULL OR NEW.contract_pdf_hash IS NULL OR NEW.contract_template_version IS NULL
   OR NEW.status<>'AWAITING_PAYMENT' OR NEW.version<>0 THEN RAISE EXCEPTION 'A contract requires an approved enrollment'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.enrollment_id,NEW.plan_code,NEW.billing_email,NEW.billing_name,NEW.billing_address,NEW.amount,NEW.quotation,NEW.contract_text,NEW.contract_digest,NEW.accepted_at,NEW.created_at,NEW.contract_pdf,NEW.contract_pdf_hash,NEW.contract_template_version)
   IS DISTINCT FROM ROW(OLD.id,OLD.enrollment_id,OLD.plan_code,OLD.billing_email,OLD.billing_name,OLD.billing_address,OLD.amount,OLD.quotation,OLD.contract_text,OLD.contract_digest,OLD.accepted_at,OLD.created_at,OLD.contract_pdf,OLD.contract_pdf_hash,OLD.contract_template_version)
   OR OLD.status<>'AWAITING_PAYMENT' OR NEW.status NOT IN ('PAID_SIMULATED','PAID','CANCELLED') OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Contract snapshot is immutable; settlement advances once';
  END IF;
  IF NEW.status='CANCELLED' AND (
   NEW.cancelled_at IS NULL OR NEW.cancelled_at < OLD.accepted_at
   OR NOT EXISTS(SELECT 1 FROM subscription WHERE source_order_id=NEW.id AND status='CANCELLED')
   OR EXISTS(SELECT 1 FROM subscription s JOIN invoice i ON i.subscription_id=s.id
     WHERE s.source_order_id=NEW.id AND i.status<>'VOID')
   OR EXISTS(SELECT 1 FROM subscription s JOIN invoice i ON i.subscription_id=s.id
     JOIN sepay_webhook_receipt r ON r.invoice_id=i.id
     WHERE s.source_order_id=NEW.id AND r.outcome IN ('MATCHED','REVIEW_REQUIRED'))
  ) THEN RAISE EXCEPTION 'Only an unpaid contract without bank receipts can be cancelled with its subscription and invoices'; END IF;
  IF NEW.status='PAID' AND NOT EXISTS(
   SELECT 1 FROM subscription s JOIN invoice i ON i.subscription_id=s.id
   JOIN enterprise_enrollment e ON e.id=NEW.enrollment_id
   WHERE s.source_order_id=NEW.id AND s.organization_id=e.organization_id
    AND i.organization_id=e.organization_id AND i.kind='INITIAL'
    AND i.status='PAID' AND i.provider='SEPAY' AND NOT i.simulated AND i.amount=NEW.amount
  ) THEN RAISE EXCEPTION 'A real contract settlement requires a matching confirmed SePay invoice'; END IF;
 END IF;
 RETURN NEW;
END $$;

