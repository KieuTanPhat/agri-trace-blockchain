-- Personal device signing keys. The phone or browser generates the key on the
-- first sign-in and registers only its public key; it signs only after the
-- account owner confirms an emailed one-time code. Organization keys created
-- by the primary account keep working (user_id NULL). Additive only.

ALTER TABLE distribution_key ADD COLUMN user_id uuid REFERENCES app_user(user_id);
ALTER TABLE distribution_key ADD COLUMN verified_at timestamptz(6);
ALTER TABLE distribution_key DROP CONSTRAINT distribution_key_status_check;
ALTER TABLE distribution_key ADD CONSTRAINT distribution_key_status_check CHECK (status IN ('PENDING','ACTIVE','REVOKED'));
ALTER TABLE distribution_key ADD CONSTRAINT distribution_key_pending_personal CHECK (status <> 'PENDING' OR user_id IS NOT NULL);
CREATE INDEX distribution_key_user ON distribution_key(user_id) WHERE user_id IS NOT NULL;

-- PENDING becomes ACTIVE once (with its verification time) or REVOKED;
-- ACTIVE only becomes REVOKED; identity columns never change.
CREATE OR REPLACE FUNCTION guard_distribution_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Signing key history is immutable'; END IF;
 IF ROW(NEW.id,NEW.organization_id,NEW.public_key,NEW.label,NEW.created_at,NEW.user_id) IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.public_key,OLD.label,OLD.created_at,OLD.user_id)
 THEN RAISE EXCEPTION 'Only key activation or revocation is allowed'; END IF;
 IF NOT ((OLD.status='PENDING' AND NEW.status='ACTIVE' AND OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL)
      OR (OLD.status IN ('PENDING','ACTIVE') AND NEW.status='REVOKED' AND NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at))
 THEN RAISE EXCEPTION 'Only key activation or revocation is allowed'; END IF;
 RETURN NEW;
END $$;

-- Emailed one-time code for a personal key. Only an HMAC of the code is kept;
-- the mail outbox holds the sealed code until it is sent.
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_kind_check;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_kind_check
  CHECK (kind IN ('APPROVED','REJECTED','CONTRACT','REGISTRATION_OTP','CREDENTIALS','ACCOUNT_CREDENTIALS','PARTNER_INVITE','SIGNING_KEY_OTP'));
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_subject_scope;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_subject_scope CHECK (
  (kind = 'REGISTRATION_OTP' AND enrollment_id IS NULL AND verification_id IS NOT NULL AND user_id IS NULL)
  OR (kind IN ('ACCOUNT_CREDENTIALS','SIGNING_KEY_OTP') AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NOT NULL)
  OR (kind = 'PARTNER_INVITE' AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NULL)
  OR (kind NOT IN ('REGISTRATION_OTP','ACCOUNT_CREDENTIALS','PARTNER_INVITE','SIGNING_KEY_OTP') AND enrollment_id IS NOT NULL AND verification_id IS NULL AND user_id IS NULL));

CREATE TABLE signing_key_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES distribution_key(id),
  user_id uuid NOT NULL REFERENCES app_user(user_id),
  mail_id uuid NOT NULL UNIQUE REFERENCES enterprise_mail(id),
  code_digest varchar(64) NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz(6) NOT NULL,
  verified_at timestamptz(6),
  superseded_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX signing_key_verification_key ON signing_key_verification(key_id, created_at);
CREATE INDEX signing_key_verification_user ON signing_key_verification(user_id, created_at);

-- A standard signature uses an active key, and a personal key only signs for
-- its owner. c2 attestations reference chain keys and are checked elsewhere.
CREATE FUNCTION guard_attestation_key() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k distribution_key%ROWTYPE;
BEGIN
 SELECT * INTO k FROM distribution_key WHERE id=NEW.key_ref;
 IF FOUND AND (k.status<>'ACTIVE' OR k.organization_id<>NEW.organization_id OR (k.user_id IS NOT NULL AND k.user_id<>NEW.user_id))
 THEN RAISE EXCEPTION 'Signature key must be active and belong to the signer'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_attestation_key BEFORE INSERT ON distribution_attestation
  FOR EACH ROW EXECUTE FUNCTION guard_attestation_key();
CREATE TRIGGER distribution_return_signature_key BEFORE INSERT ON distribution_return_signature
  FOR EACH ROW EXECUTE FUNCTION guard_attestation_key();
