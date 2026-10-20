-- Public signup no longer takes a password. The account receives a generated
-- temporary password by mail after its owner email passed OTP; the ciphertext
-- is cleared once the Worker sends it, exactly like registration OTP mail.
ALTER TABLE enterprise_mail DROP CONSTRAINT enterprise_mail_kind_check;
ALTER TABLE enterprise_mail ADD CONSTRAINT enterprise_mail_kind_check
  CHECK (kind IN ('APPROVED','REJECTED','CONTRACT','REGISTRATION_OTP','CREDENTIALS'));
