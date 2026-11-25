CREATE FUNCTION guard_subscription_term_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subscription term history cannot be deleted';
  END IF;
  IF (NEW.subscription_id, NEW.invoice_id, NEW.plan_version_id, NEW.contract_preview_id, NEW.created_by, NEW.accepted_at)
    IS DISTINCT FROM (OLD.subscription_id, OLD.invoice_id, OLD.plan_version_id, OLD.contract_preview_id, OLD.created_by, OLD.accepted_at)
  THEN RAISE EXCEPTION 'accepted renewal contract is immutable'; END IF;
  IF OLD.starts_at IS NOT NULL AND (NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at)
  THEN RAISE EXCEPTION 'paid renewal period is immutable'; END IF;
  IF NOT (OLD.status = NEW.status OR
    (OLD.status = 'AWAITING_PAYMENT' AND NEW.status IN ('SCHEDULED','ACTIVE','VOID')) OR
    (OLD.status = 'SCHEDULED' AND NEW.status = 'ACTIVE'))
  THEN RAISE EXCEPTION 'invalid renewal status transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER subscription_term_history BEFORE UPDATE OR DELETE ON subscription_term
  FOR EACH ROW EXECUTE FUNCTION guard_subscription_term_history();
