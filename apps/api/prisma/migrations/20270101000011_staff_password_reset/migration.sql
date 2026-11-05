-- Staff-only email recovery. Requesting a code never changes account credentials.
CREATE TABLE staff_password_reset (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  email varchar(255) NOT NULL,
  password_digest varchar(64) NOT NULL CHECK (password_digest ~ '^[0-9a-f]{64}$'),
  code_digest varchar(64) NOT NULL CHECK (code_digest ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  superseded_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX ix_staff_reset_user_created ON staff_password_reset(user_id, created_at DESC);
CREATE UNIQUE INDEX uq_staff_reset_open ON staff_password_reset(user_id)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;
ALTER TABLE enterprise_mail ADD COLUMN staff_reset_id uuid UNIQUE
  REFERENCES staff_password_reset(id) ON DELETE RESTRICT;
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_kind_check;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_kind_check CHECK (
  kind IN ('APPROVED','REJECTED','CONTRACT','REGISTRATION_OTP','CREDENTIALS','ACCOUNT_CREDENTIALS','STAFF_PASSWORD_RESET')
);
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_subject_scope;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_subject_scope CHECK (
  (kind = 'STAFF_PASSWORD_RESET' AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NOT NULL AND staff_reset_id IS NOT NULL)
  OR (staff_reset_id IS NULL AND (
    (kind = 'REGISTRATION_OTP' AND enrollment_id IS NULL AND verification_id IS NOT NULL AND user_id IS NULL)
    OR (kind = 'ACCOUNT_CREDENTIALS' AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NOT NULL)
    OR (kind NOT IN ('REGISTRATION_OTP','ACCOUNT_CREDENTIALS','STAFF_PASSWORD_RESET') AND enrollment_id IS NOT NULL AND verification_id IS NULL AND user_id IS NULL)
  ))
);
