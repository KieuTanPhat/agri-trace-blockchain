-- Additive only: historical devices retain UNKNOWN provenance.
ALTER TABLE iot_device ADD COLUMN source_type varchar(30) NOT NULL DEFAULT 'UNKNOWN'
  CHECK (source_type IN ('UNKNOWN', 'WOKWI_SIMULATED'));
ALTER TABLE iot_device ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK (version >= 0);

CREATE TABLE device_credential (
  credential_id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES iot_device(device_id) ON DELETE RESTRICT,
  verifier varchar(64) NOT NULL CHECK (verifier ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE UNIQUE INDEX ux_device_credential_active ON device_credential(device_id) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION fn_hybrid_device_authority_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id OR NEW.source_type <> OLD.source_type THEN
    RAISE EXCEPTION 'Device owner and source are immutable';
  END IF;
  IF NEW.version NOT IN (OLD.version, OLD.version + 1) THEN
    RAISE EXCEPTION 'Invalid device version transition';
  END IF;
  IF NEW.authority_revision <> OLD.authority_revision THEN
    RAISE EXCEPTION 'Device authority revision is database managed';
  END IF;
  IF (NEW.cycle_id, NEW.device_code, NEW.status, NEW.version)
      IS DISTINCT FROM (OLD.cycle_id, OLD.device_code, OLD.status, OLD.version) THEN
    NEW.authority_revision := OLD.authority_revision + 1;
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fn_device_credential_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Credential history is immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.credential_id, NEW.device_id, NEW.verifier, NEW.created_at, NEW.expires_at)
      IS DISTINCT FROM (OLD.credential_id, OLD.device_id, OLD.verifier, OLD.created_at, OLD.expires_at)
      OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'Only first credential revocation is permitted';
    END IF;
    NEW.revision := OLD.revision + 1;
  ELSIF NEW.revoked_at IS NOT NULL OR NEW.revision <> 0 THEN
    RAISE EXCEPTION 'A new credential starts active at revision zero';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_device_credential_immutable BEFORE INSERT OR UPDATE OR DELETE ON device_credential
  FOR EACH ROW EXECUTE FUNCTION fn_device_credential_immutable();

CREATE FUNCTION fn_device_credential_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE iot_device SET version = version + 1, updated_at = now() WHERE device_id = NEW.device_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_device_credential_epoch AFTER INSERT OR UPDATE ON device_credential
  FOR EACH ROW EXECUTE FUNCTION fn_device_credential_epoch();
