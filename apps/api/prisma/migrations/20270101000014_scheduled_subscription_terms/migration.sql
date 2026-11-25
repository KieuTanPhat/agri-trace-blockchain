CREATE TABLE subscription_term (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscription(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL UNIQUE REFERENCES invoice(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES service_plan_version(id) ON DELETE RESTRICT,
  contract_preview_id uuid NOT NULL REFERENCES service_contract_preview(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  starts_at timestamptz, ends_at timestamptz,
  status varchar(30) NOT NULL DEFAULT 'AWAITING_PAYMENT'
    CHECK (status IN ('AWAITING_PAYMENT','SCHEDULED','ACTIVE','VOID')),
  activated_at timestamptz,
  CHECK ((starts_at IS NULL AND ends_at IS NULL AND status IN ('AWAITING_PAYMENT','VOID'))
      OR (starts_at IS NOT NULL AND ends_at > starts_at AND status IN ('SCHEDULED','ACTIVE'))),
  CHECK ((status = 'ACTIVE') = (activated_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_subscription_term_waiting ON subscription_term(subscription_id)
  WHERE status IN ('AWAITING_PAYMENT','SCHEDULED');
CREATE INDEX ix_subscription_term_due ON subscription_term(status, starts_at);
CREATE FUNCTION guard_subscription_term_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM invoice i JOIN subscription s ON s.id = i.subscription_id
    JOIN enterprise_enrollment e ON e.organization_id = s.organization_id
    JOIN service_contract_preview p ON p.enrollment_id = e.id
    WHERE i.id = NEW.invoice_id AND i.subscription_id = NEW.subscription_id
      AND i.plan_version_id = NEW.plan_version_id AND i.kind = 'RENEWAL'
      AND p.id = NEW.contract_preview_id AND p.created_by = NEW.created_by)
  THEN RAISE EXCEPTION 'subscription term scope mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER subscription_term_scope BEFORE INSERT OR UPDATE ON subscription_term
  FOR EACH ROW EXECUTE FUNCTION guard_subscription_term_scope();
