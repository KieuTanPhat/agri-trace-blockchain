CREATE TABLE enterprise_enrollment (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL UNIQUE REFERENCES organization(organization_id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE RESTRICT,
  registration_digest varchar(64) NOT NULL CHECK (registration_digest ~ '^[a-f0-9]{64}$'),
  business_id varchar(40) NOT NULL UNIQUE,
  hosting_mode varchar(30) NOT NULL CHECK (hosting_mode IN ('MANAGED_ORG','SELF_MANAGED_ORG')),
  status varchar(30) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','APPROVED','REJECTED')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  review_note varchar(1000), reviewed_by uuid REFERENCES app_user(user_id),
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TABLE enterprise_connection (
  id uuid PRIMARY KEY, enrollment_id uuid NOT NULL REFERENCES enterprise_enrollment(id) ON DELETE RESTRICT,
  chain_id uuid NOT NULL REFERENCES supply_chain(chain_id) ON DELETE RESTRICT,
  hosting_mode varchar(30) NOT NULL CHECK (hosting_mode IN ('MANAGED_ORG','SELF_MANAGED_ORG')),
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(30) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','APPROVED','CHECKING','CONNECTED','UNKNOWN','FAILED','REJECTED')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0), review_note varchar(1000), reviewed_by uuid REFERENCES app_user(user_id),
  challenge uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tx_id varchar(64) UNIQUE CHECK (tx_id IS NULL OR tx_id ~ '^[a-f0-9]{64}$'),
  binding_digest varchar(64), evidence jsonb, error_code varchar(60),
  lease_token uuid, lease_expires_at timestamptz(6), checked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((status = 'CONNECTED') = (evidence IS NOT NULL)),
  CHECK (status <> 'CONNECTED' OR (tx_id IS NOT NULL AND binding_digest IS NOT NULL AND checked_at IS NOT NULL))
);
CREATE INDEX enterprise_connection_status_lease_expires_at_idx ON enterprise_connection(status, lease_expires_at);
CREATE UNIQUE INDEX ux_enterprise_connection_open ON enterprise_connection(enrollment_id,chain_id) WHERE status NOT IN ('REJECTED','FAILED');
CREATE TABLE enterprise_msp_allocation (
  network varchar(100) NOT NULL, msp_id varchar(100) NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(), PRIMARY KEY(network,msp_id)
);
CREATE TRIGGER trg_enterprise_msp_allocation_immutable BEFORE UPDATE OR DELETE ON enterprise_msp_allocation
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE FUNCTION guard_enterprise_onboarding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Onboarding history cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'Onboarding update needs the next version'; END IF;
    IF TG_TABLE_NAME = 'enterprise_enrollment' THEN
      IF ROW(NEW.id,NEW.organization_id,NEW.owner_id,NEW.registration_digest,NEW.business_id,NEW.hosting_mode)
         IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.owner_id,OLD.registration_digest,OLD.business_id,OLD.hosting_mode)
         OR OLD.status <> 'PENDING_REVIEW' OR NEW.status NOT IN ('APPROVED','REJECTED') THEN
        RAISE EXCEPTION 'Registration identity and review decision are immutable';
      END IF;
    ELSE
      IF ROW(NEW.id,NEW.enrollment_id,NEW.chain_id,NEW.hosting_mode,NEW.public_config,NEW.challenge)
         IS DISTINCT FROM ROW(OLD.id,OLD.enrollment_id,OLD.chain_id,OLD.hosting_mode,OLD.public_config,OLD.challenge)
         OR (OLD.tx_id IS NOT NULL AND NEW.tx_id IS DISTINCT FROM OLD.tx_id)
         OR OLD.status IN ('CONNECTED','REJECTED','FAILED') THEN
        RAISE EXCEPTION 'Connection identity, submitted transaction and terminal evidence are immutable';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enterprise_enrollment_guard BEFORE UPDATE OR DELETE ON enterprise_enrollment FOR EACH ROW EXECUTE FUNCTION guard_enterprise_onboarding();
CREATE TRIGGER trg_enterprise_connection_guard BEFORE UPDATE OR DELETE ON enterprise_connection FOR EACH ROW EXECUTE FUNCTION guard_enterprise_onboarding();
