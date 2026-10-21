-- Additive: existing email accounts and nullable legacy session families are unchanged.
INSERT INTO app_role (role_id, code, name, description)
VALUES (gen_random_uuid(), 'CONSUMER', 'Người tiêu dùng', 'Public consumer application; no business authority')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE app_user ADD COLUMN phone varchar(16);
CREATE UNIQUE INDEX app_user_phone_key ON app_user(phone);
ALTER TABLE app_user ADD CONSTRAINT ck_user_phone_identity CHECK (
  phone IS NULL OR (phone ~ '^\+84[0-9]{9}$' AND email = substring(phone FROM 2) || '@phone.invalid' AND organization_id IS NULL)
);

CREATE TABLE consumer_profile (
  user_id uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  contact_email varchar(255), province_code varchar(10) NOT NULL,
  province_name varchar(255) NOT NULL, ward_code varchar(10) NOT NULL,
  ward_name varchar(255) NOT NULL, business_address varchar(255),
  consent_version varchar(120) NOT NULL, consented_at timestamptz(6) NOT NULL DEFAULT now(),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TABLE consumer_phone_proof (
  token_hash varchar(64) PRIMARY KEY, proof_key varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz(6) NOT NULL, used_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TABLE consumer_auth_limit (
  key_hash varchar(64) PRIMARY KEY, window_at timestamptz(6) NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
