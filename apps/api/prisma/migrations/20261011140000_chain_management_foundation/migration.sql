BEGIN;

-- Additive foundation only. Existing cycle/shipment/evidence tables and their
-- triggers remain unchanged until the scoped business rollout is verified.
CREATE TYPE "ChainMembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "GrantScope" AS ENUM ('ORGANIZATION', 'CHAIN');
CREATE TYPE "ScopedRole" AS ENUM ('ORG_ADMIN', 'CREATE_CHAIN', 'CHAIN_MANAGER', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR', 'COMPLIANCE_REVIEWER');

CREATE UNIQUE INDEX uq_user_org_scope ON app_user (user_id, organization_id);

CREATE TABLE organization_capability (
  organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE CASCADE,
  code organization_type NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (organization_id, code)
);

CREATE TABLE supply_chain (
  chain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  name varchar(255) NOT NULL CHECK (length(btrim(name)) > 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX supply_chain_owner_organization_id_idx ON supply_chain (owner_organization_id);

CREATE TABLE chain_membership (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  status "ChainMembershipStatus" NOT NULL DEFAULT 'INVITED',
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  invitation_revision integer NOT NULL DEFAULT 0 CHECK (invitation_revision >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_chain_membership_org UNIQUE (chain_id, organization_id)
);
CREATE INDEX chain_membership_organization_id_status_idx ON chain_membership (organization_id, status);

CREATE TABLE scoped_role_grant (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization ON UPDATE NO ACTION ON DELETE RESTRICT,
  chain_id uuid REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  scope "GrantScope" NOT NULL,
  role "ScopedRole" NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6),
  FOREIGN KEY (user_id, organization_id) REFERENCES app_user (user_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  FOREIGN KEY (chain_id, organization_id) REFERENCES chain_membership (chain_id, organization_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ck_scoped_role_kind CHECK (
    (scope = 'ORGANIZATION' AND chain_id IS NULL AND role IN ('ORG_ADMIN', 'CREATE_CHAIN')) OR
    (scope = 'CHAIN' AND chain_id IS NOT NULL AND role NOT IN ('ORG_ADMIN', 'CREATE_CHAIN'))
  )
);
CREATE UNIQUE INDEX uq_scoped_role_org_active ON scoped_role_grant (user_id, organization_id, role) WHERE chain_id IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX uq_scoped_role_chain_active ON scoped_role_grant (user_id, organization_id, chain_id, role) WHERE chain_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX scoped_role_grant_user_id_revoked_at_idx ON scoped_role_grant (user_id, revoked_at);
CREATE INDEX scoped_role_grant_chain_id_organization_id_idx ON scoped_role_grant (chain_id, organization_id);

CREATE TABLE chain_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid REFERENCES supply_chain ON UPDATE NO ACTION ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES app_user ON UPDATE NO ACTION ON DELETE RESTRICT,
  operation varchar(80) NOT NULL,
  subject_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX chain_audit_chain_id_created_at_idx ON chain_audit (chain_id, created_at);

-- Serialize the primary-capability backfill with organization creation; without
-- this lock an INSERT between the backfill and trigger could miss its capability.
LOCK TABLE organization IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO organization_capability (organization_id, code)
SELECT organization_id, type FROM organization;

CREATE FUNCTION fn_seed_primary_capability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_capability (organization_id, code) VALUES (NEW.organization_id, NEW.type);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_seed_primary_capability AFTER INSERT ON organization
  FOR EACH ROW EXECUTE FUNCTION fn_seed_primary_capability();

CREATE FUNCTION fn_lock_chain_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Chain management audit is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER trg_lock_chain_audit BEFORE UPDATE OR DELETE ON chain_audit
  FOR EACH ROW EXECUTE FUNCTION fn_lock_chain_history();

CREATE FUNCTION fn_lock_scoped_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Grant history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.grant_id, NEW.user_id, NEW.organization_id, NEW.chain_id, NEW.scope, NEW.role, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.grant_id, OLD.user_id, OLD.organization_id, OLD.chain_id, OLD.scope, OLD.role, OLD.created_at)
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Grant may only be revoked once; issue a fresh grant to reauthorize' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lock_scoped_grant BEFORE UPDATE OR DELETE ON scoped_role_grant
  FOR EACH ROW EXECUTE FUNCTION fn_lock_scoped_grant();

CREATE FUNCTION fn_lock_chain_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_organization_id IS DISTINCT FROM OLD.owner_organization_id THEN
    RAISE EXCEPTION 'Chain ownership transfer is not supported' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lock_chain_owner BEFORE UPDATE ON supply_chain
  FOR EACH ROW EXECUTE FUNCTION fn_lock_chain_owner();

CREATE FUNCTION fn_guard_chain_membership() RETURNS trigger LANGUAGE plpgsql AS $$
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
      OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('INVITED', 'REVOKED'))
      OR (OLD.status = 'REVOKED' AND NEW.status = 'INVITED'))
  ) THEN
    RAISE EXCEPTION 'Invalid membership transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id = (SELECT owner_organization_id FROM supply_chain WHERE chain_id = NEW.chain_id)
    AND NEW.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Owner membership must remain active' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_chain_membership BEFORE INSERT OR UPDATE OR DELETE ON chain_membership
  FOR EACH ROW EXECUTE FUNCTION fn_guard_chain_membership();

CREATE FUNCTION fn_validate_chain_owner_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM chain_membership WHERE chain_id = NEW.chain_id
    AND organization_id = NEW.owner_organization_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Chain requires an active owner membership' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_validate_chain_owner_membership AFTER INSERT ON supply_chain
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_validate_chain_owner_membership();

COMMIT;
