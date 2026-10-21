-- Every account created by someone else (enterprise member, platform user)
-- receives a generated temporary password by mail and must replace it at
-- first sign-in. Such mail belongs to the account, not to an enrollment.
ALTER TABLE enterprise_mail
  ADD COLUMN user_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT;
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_kind_check;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_kind_check
  CHECK (kind IN ('APPROVED','REJECTED','CONTRACT','REGISTRATION_OTP','CREDENTIALS','ACCOUNT_CREDENTIALS'));
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_subject_scope;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_subject_scope CHECK (
  (kind = 'REGISTRATION_OTP' AND enrollment_id IS NULL AND verification_id IS NOT NULL AND user_id IS NULL)
  OR (kind = 'ACCOUNT_CREDENTIALS' AND enrollment_id IS NULL AND verification_id IS NULL AND user_id IS NOT NULL)
  OR (kind NOT IN ('REGISTRATION_OTP','ACCOUNT_CREDENTIALS') AND enrollment_id IS NOT NULL AND verification_id IS NULL AND user_id IS NULL));
CREATE INDEX ix_enterprise_mail_user ON enterprise_mail (user_id) WHERE user_id IS NOT NULL;
