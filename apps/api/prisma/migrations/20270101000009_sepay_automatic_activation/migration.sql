-- Manual activation retains its recorded user. Automatic activation has no
-- human actor and is accepted only with a committed, matched provider receipt.
ALTER TABLE enterprise_enrollment DROP CONSTRAINT enterprise_manual_activation;
ALTER TABLE enterprise_enrollment ADD CONSTRAINT enterprise_activation_metadata CHECK (
 (service_activated_at IS NULL AND service_activated_by IS NULL AND service_activation_reason IS NULL)
 OR (service_activated_at IS NOT NULL AND length(btrim(service_activation_reason))>=10)
);

CREATE FUNCTION check_sepay_automatic_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM subscription s
  JOIN enterprise_service_order o ON o.id=s.source_order_id AND o.enrollment_id=NEW.id
  JOIN invoice i ON i.subscription_id=s.id AND i.organization_id=NEW.organization_id
  JOIN sepay_webhook_receipt r ON r.invoice_id=i.id AND r.outcome='MATCHED'
  WHERE s.organization_id=NEW.organization_id AND s.status='ACTIVE'
   AND i.kind='INITIAL' AND i.status='PAID' AND i.amount=o.amount
   AND i.provider_reference='SEPAY:'||r.mode||':'||r.transaction_id
   AND ((r.mode='test' AND i.provider='SIMULATION' AND i.simulated AND o.status='PAID_SIMULATED')
     OR (r.mode='live' AND i.provider='SEPAY' AND NOT i.simulated AND o.status='PAID'))
 ) THEN RAISE EXCEPTION 'Automatic activation requires the matching committed SePay payment receipt'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sepay_automatic_activation_receipt
 AFTER UPDATE ON enterprise_enrollment DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (OLD.service_activated_at IS NULL AND NEW.service_activated_at IS NOT NULL AND NEW.service_activated_by IS NULL)
 EXECUTE FUNCTION check_sepay_automatic_activation();
