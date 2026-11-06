-- Personal device signing keys no longer wait for an emailed one-time code:
-- a key is ACTIVE as soon as it is registered with its proof of possession.
-- Drops the code table, the code mails and the PENDING key state. A key left
-- PENDING never signed, so it is revoked (the guard allows PENDING→REVOKED).

UPDATE distribution_key SET status = 'REVOKED' WHERE status = 'PENDING';

DROP TABLE signing_key_verification;
DELETE FROM enterprise_mail WHERE kind = 'SIGNING_KEY_OTP';

ALTER TABLE distribution_key DROP CONSTRAINT distribution_key_pending_personal;
ALTER TABLE distribution_key DROP CONSTRAINT distribution_key_status_check;
ALTER TABLE distribution_key ADD CONSTRAINT distribution_key_status_check CHECK (status IN ('ACTIVE','REVOKED'));

-- ACTIVE only becomes REVOKED; identity columns and verification time never change.
CREATE OR REPLACE FUNCTION guard_distribution_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Signing key history is immutable'; END IF;
 IF ROW(NEW.id,NEW.organization_id,NEW.public_key,NEW.label,NEW.created_at,NEW.user_id,NEW.verified_at) IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.public_key,OLD.label,OLD.created_at,OLD.user_id,OLD.verified_at)
 THEN RAISE EXCEPTION 'Only key revocation is allowed'; END IF;
 IF NOT (OLD.status='ACTIVE' AND NEW.status='REVOKED')
 THEN RAISE EXCEPTION 'Only key revocation is allowed'; END IF;
 RETURN NEW;
END $$;

ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_kind_check;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_kind_check
  CHECK (kind IN ('APPROVED','REJECTED','CONTRACT','REGISTRATION_OTP','CREDENTIALS','ACCOUNT_CREDENTIALS','PARTNER_INVITE'));
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_subject_scope;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_subject_scope CHECK (
  (kind = 'REGISTRATION_OTP' AND enrollment_id IS NULL AND verification_id IS NOT NULL AND user_id IS NULL)
  OR (kind = 'ACCOUNT_CREDENTIALS' AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NOT NULL)
  OR (kind = 'PARTNER_INVITE' AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NULL)
  OR (kind NOT IN ('REGISTRATION_OTP','ACCOUNT_CREDENTIALS','PARTNER_INVITE') AND enrollment_id IS NOT NULL AND verification_id IS NULL AND user_id IS NULL));
