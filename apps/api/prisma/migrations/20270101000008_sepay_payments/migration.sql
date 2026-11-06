-- Additive provider receipts; never backfill a simulated payment as real.
ALTER TABLE enterprise_service_order DROP CONSTRAINT enterprise_service_order_status_check;
ALTER TABLE enterprise_service_order DROP CONSTRAINT enterprise_service_order_check;
ALTER TABLE enterprise_service_order
 ADD CONSTRAINT enterprise_service_order_status_check CHECK(status IN ('AWAITING_PAYMENT','PAID_SIMULATED','PAID')),
 ADD CONSTRAINT enterprise_service_order_settlement_check CHECK(
  (status='AWAITING_PAYMENT' AND paid_at IS NULL)
  OR (status IN ('PAID_SIMULATED','PAID') AND paid_at IS NOT NULL));

CREATE OR REPLACE FUNCTION guard_enterprise_service_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Service contract history cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM enterprise_enrollment WHERE id=NEW.enrollment_id AND status='APPROVED')
   OR NEW.status<>'AWAITING_PAYMENT' OR NEW.version<>0 THEN RAISE EXCEPTION 'A contract requires an approved enrollment'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.enrollment_id,NEW.plan_code,NEW.billing_email,NEW.billing_name,NEW.billing_address,NEW.amount,NEW.quotation,NEW.contract_text,NEW.contract_digest,NEW.accepted_at,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.enrollment_id,OLD.plan_code,OLD.billing_email,OLD.billing_name,OLD.billing_address,OLD.amount,OLD.quotation,OLD.contract_text,OLD.contract_digest,OLD.accepted_at,OLD.created_at)
   OR OLD.status<>'AWAITING_PAYMENT' OR NEW.status NOT IN ('PAID_SIMULATED','PAID') OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Contract snapshot is immutable; settlement advances once';
  END IF;
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

CREATE TABLE sepay_webhook_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 mode varchar(4) NOT NULL CHECK(mode IN ('test','live')),
 transaction_id varchar(20) NOT NULL CHECK(transaction_id ~ '^[0-9]+$'),
 payload_hash varchar(64) NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 invoice_id uuid REFERENCES invoice(id) ON DELETE RESTRICT,
 outcome varchar(20) NOT NULL CHECK(outcome IN ('MATCHED','IGNORED','REVIEW_REQUIRED')),
 reason varchar(100) NOT NULL,
 received_at timestamptz(6) NOT NULL DEFAULT now(),
 CONSTRAINT sepay_webhook_receipt_mode_transaction_id_key UNIQUE(mode,transaction_id)
);
CREATE INDEX sepay_webhook_receipt_invoice_id_received_at_idx ON sepay_webhook_receipt(invoice_id,received_at DESC);
CREATE TRIGGER sepay_webhook_receipt_append_only BEFORE UPDATE OR DELETE ON sepay_webhook_receipt
 FOR EACH ROW EXECUTE FUNCTION guard_append_only();
