-- Extend registration only; historical registrations and business evidence retain their values.
ALTER TABLE enterprise_enrollment ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE enterprise_profile ADD COLUMN registration_data jsonb NOT NULL DEFAULT '{}';
ALTER TABLE enterprise_profile DROP CONSTRAINT enterprise_profile_legal_form_check;
ALTER TABLE enterprise_profile ADD CONSTRAINT enterprise_profile_legal_form_check CHECK
 (legal_form IN ('ENTERPRISE','COOPERATIVE','HOUSEHOLD_BUSINESS','PRODUCER_HOUSEHOLD','INDIVIDUAL_PRODUCER'));
CREATE TABLE enterprise_registration_document (
 id uuid PRIMARY KEY, registration_id uuid NOT NULL,
 verification_id uuid NOT NULL REFERENCES registration_email_verification(id) ON DELETE RESTRICT,
 organization_id uuid REFERENCES organization(organization_id) ON DELETE RESTRICT,
 kind varchar(30) NOT NULL CHECK(kind IN ('LOGO','LEGAL_REGISTRATION','AUTHORIZATION','CERTIFICATE')),
 file_name varchar(180) NOT NULL, media_type varchar(40) NOT NULL,
 size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880),
 sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), content bytea NOT NULL,
 created_at timestamptz(6) NOT NULL DEFAULT now(), CHECK(octet_length(content)=size)
);
CREATE INDEX ix_registration_document_registration ON enterprise_registration_document(registration_id);
CREATE INDEX ix_registration_document_organization ON enterprise_registration_document(organization_id);
CREATE FUNCTION guard_registration_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.organization_id IS NOT NULL THEN RAISE EXCEPTION 'Submitted registration evidence cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.organization_id IS NOT NULL OR NEW.organization_id IS NULL OR
  ROW(NEW.id,NEW.registration_id,NEW.verification_id,NEW.kind,NEW.file_name,NEW.media_type,NEW.size,NEW.sha256,NEW.content,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.registration_id,OLD.verification_id,OLD.kind,OLD.file_name,OLD.media_type,OLD.size,OLD.sha256,OLD.content,OLD.created_at))
 THEN RAISE EXCEPTION 'Registration document evidence is immutable'; END IF;
 IF NEW.organization_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM enterprise_enrollment e WHERE e.id=NEW.registration_id AND e.organization_id=NEW.organization_id)
 THEN RAISE EXCEPTION 'Document must belong to its submitted registration'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER registration_document_guard BEFORE INSERT OR UPDATE OR DELETE ON enterprise_registration_document FOR EACH ROW EXECUTE FUNCTION guard_registration_document();
CREATE FUNCTION guard_registration_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.registration_data IS DISTINCT FROM OLD.registration_data OR NEW.declaration_accepted_at IS DISTINCT FROM OLD.declaration_accepted_at
 THEN RAISE EXCEPTION 'Submitted registration and acceptance evidence cannot be rewritten'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER registration_acceptance_guard BEFORE UPDATE ON enterprise_profile FOR EACH ROW EXECUTE FUNCTION guard_registration_acceptance();
