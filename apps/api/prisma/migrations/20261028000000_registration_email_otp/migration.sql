CREATE TABLE registration_email_verification (
  id uuid PRIMARY KEY, registration_id uuid NOT NULL, email varchar(255) NOT NULL,
  code_digest varchar(64) NOT NULL CHECK(code_digest ~ '^[a-f0-9]{64}$'), attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  verified_at timestamptz, consumed_at timestamptz, superseded_at timestamptz,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(consumed_at IS NULL OR verified_at IS NOT NULL), CHECK(expires_at>created_at), CHECK(email=lower(email))
);
CREATE INDEX registration_email_verification_email_created_at_idx ON registration_email_verification(email,created_at);
CREATE INDEX registration_email_verification_registration_id_email_idx ON registration_email_verification(registration_id,email);
CREATE TABLE registration_otp_attempt (
  id uuid PRIMARY KEY, verification_id uuid NOT NULL REFERENCES registration_email_verification(id) ON DELETE RESTRICT,
  request_digest varchar(64) NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'), success boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE enterprise_mail ALTER COLUMN enrollment_id DROP NOT NULL;
ALTER TABLE enterprise_mail ADD COLUMN verification_id uuid UNIQUE REFERENCES registration_email_verification(id) ON DELETE RESTRICT, ADD COLUMN otp_ciphertext text;
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_kind_check, DROP CONSTRAINT enterprise_mail_status_check;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_kind_check CHECK(kind IN ('APPROVED','REJECTED','CONTRACT','REGISTRATION_OTP')),
  ADD CONSTRAINT enterprise_mail_status_check CHECK(status IN ('PENDING','SENT','CANCELLED')),
  ADD CONSTRAINT enterprise_mail_subject_scope CHECK((kind='REGISTRATION_OTP' AND enrollment_id IS NULL AND verification_id IS NOT NULL) OR (kind<>'REGISTRATION_OTP' AND enrollment_id IS NOT NULL AND verification_id IS NULL));
CREATE FUNCTION guard_registration_otp_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'OTP attempt receipts are immutable'; END $$;
CREATE TRIGGER trg_registration_otp_attempt BEFORE UPDATE OR DELETE ON registration_otp_attempt FOR EACH ROW EXECUTE FUNCTION guard_registration_otp_attempt();
