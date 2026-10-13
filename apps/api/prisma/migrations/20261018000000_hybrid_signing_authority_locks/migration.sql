BEGIN;

-- Preserve the prior guard exactly, adding the missing key row lock. A direct
-- SQL revoke must serialize with prepare/consume, just like API authority.
CREATE OR REPLACE FUNCTION fn_c_signing_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key_status signing_key_status;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Signing intents are never deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.signature IS NOT NULL THEN
      RAISE EXCEPTION 'A signing intent starts PENDING and unsigned';
    END IF;
    SELECT status INTO key_status FROM signing_key WHERE key_ref = NEW.key_ref FOR SHARE;
    IF key_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Signing key is not ACTIVE'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.intent_id, NEW.chain_id, NEW.binding_digest, NEW.organization_id, NEW.key_ref, NEW.created_by,
         NEW.operation, NEW.entity_type, NEW.entity_id, NEW.event_id, NEW.event_type, NEW.expected_version,
         NEW.payload, NEW.payload_digest, NEW.intent, NEW.intent_digest, NEW.policy_version, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.intent_id, OLD.chain_id, OLD.binding_digest, OLD.organization_id, OLD.key_ref, OLD.created_by,
         OLD.operation, OLD.entity_type, OLD.entity_id, OLD.event_id, OLD.event_type, OLD.expected_version,
         OLD.payload, OLD.payload_digest, OLD.intent, OLD.intent_digest, OLD.policy_version, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'A signing intent is immutable once prepared';
  END IF;
  IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'A consumed or expired intent cannot change'; END IF;
  IF NEW.status = 'CONSUMED' THEN
    SELECT status INTO key_status FROM signing_key WHERE key_ref = NEW.key_ref FOR SHARE;
    IF key_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Signing key is no longer ACTIVE'; END IF;
  ELSIF NEW.status = 'EXPIRED' THEN
    IF NEW.signature IS NOT NULL THEN RAISE EXCEPTION 'An expired intent carries no signature'; END IF;
  ELSE
    RAISE EXCEPTION 'Illegal signing intent transition';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
