-- Existing accepted contracts remain unchanged; newly accepted contracts require PDF snapshots.
CREATE TABLE service_contract_preview (
 id uuid PRIMARY KEY,
 enrollment_id uuid NOT NULL REFERENCES enterprise_enrollment(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
 input jsonb NOT NULL, quotation jsonb NOT NULL, contract_text text NOT NULL,
 source_digest varchar(64) NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 contract_digest varchar(64) NOT NULL UNIQUE CHECK(contract_digest ~ '^[a-f0-9]{64}$'),
 pdf_bytes bytea NOT NULL, pdf_sha256 varchar(64) NOT NULL,
 template_version varchar(40) NOT NULL,
 created_at timestamptz(6) NOT NULL DEFAULT now(), expires_at timestamptz(6) NOT NULL,
 CHECK(expires_at > created_at),
 CHECK(octet_length(pdf_bytes) BETWEEN 5 AND 2097152 AND substring(pdf_bytes from 1 for 5)=convert_to('%PDF-','UTF8')),
 CHECK(encode(sha256(pdf_bytes),'hex')=pdf_sha256)
);
CREATE INDEX service_contract_preview_enrollment_id_created_at_idx ON service_contract_preview(enrollment_id,created_at DESC);
CREATE TRIGGER service_contract_preview_append_only BEFORE UPDATE OR DELETE ON service_contract_preview
 FOR EACH ROW EXECUTE FUNCTION guard_append_only();
ALTER TABLE enterprise_service_order
 ADD COLUMN contract_pdf bytea, ADD COLUMN contract_pdf_hash varchar(64), ADD COLUMN contract_template_version varchar(40),
 ADD CONSTRAINT service_order_pdf_snapshot CHECK(
 (contract_pdf IS NULL AND contract_pdf_hash IS NULL AND contract_template_version IS NULL)
 OR (contract_pdf IS NOT NULL AND contract_pdf_hash IS NOT NULL AND contract_template_version IS NOT NULL
 AND octet_length(contract_pdf) BETWEEN 5 AND 2097152 AND encode(sha256(contract_pdf),'hex')=contract_pdf_hash));
ALTER TABLE enterprise_mail ADD COLUMN attachment_pdf bytea, ADD COLUMN attachment_pdf_hash varchar(64),
 ADD CONSTRAINT enterprise_mail_pdf_snapshot CHECK(
 (attachment_pdf IS NULL AND attachment_pdf_hash IS NULL) OR
 (attachment_pdf IS NOT NULL AND attachment_pdf_hash IS NOT NULL AND octet_length(attachment_pdf) BETWEEN 5 AND 2097152
 AND encode(sha256(attachment_pdf),'hex')=attachment_pdf_hash));
CREATE FUNCTION guard_contract_mail_pdf() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.attachment_pdf,NEW.attachment_pdf_hash) IS DISTINCT FROM ROW(OLD.attachment_pdf,OLD.attachment_pdf_hash)
 THEN RAISE EXCEPTION 'Mail PDF snapshot is immutable'; END IF;
 IF TG_OP='INSERT' AND NEW.attachment_pdf IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM enterprise_service_order WHERE enrollment_id=NEW.enrollment_id
 AND contract_pdf_hash=NEW.attachment_pdf_hash AND contract_pdf=NEW.attachment_pdf
 AND status IN ('PAID','PAID_SIMULATED')) THEN RAISE EXCEPTION 'Mail requires the settled contract PDF'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contract_mail_pdf_guard BEFORE INSERT OR UPDATE ON enterprise_mail FOR EACH ROW EXECUTE FUNCTION guard_contract_mail_pdf();

CREATE OR REPLACE FUNCTION guard_enterprise_service_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Service contract history cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM enterprise_enrollment WHERE id=NEW.enrollment_id AND status='APPROVED')
   OR NEW.contract_pdf IS NULL OR NEW.contract_pdf_hash IS NULL OR NEW.contract_template_version IS NULL
   OR NEW.status<>'AWAITING_PAYMENT' OR NEW.version<>0 THEN RAISE EXCEPTION 'A contract requires an approved enrollment'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.enrollment_id,NEW.plan_code,NEW.billing_email,NEW.billing_name,NEW.billing_address,NEW.amount,NEW.quotation,NEW.contract_text,NEW.contract_digest,NEW.accepted_at,NEW.created_at,NEW.contract_pdf,NEW.contract_pdf_hash,NEW.contract_template_version)
   IS DISTINCT FROM ROW(OLD.id,OLD.enrollment_id,OLD.plan_code,OLD.billing_email,OLD.billing_name,OLD.billing_address,OLD.amount,OLD.quotation,OLD.contract_text,OLD.contract_digest,OLD.accepted_at,OLD.created_at,OLD.contract_pdf,OLD.contract_pdf_hash,OLD.contract_template_version)
   OR OLD.status<>'AWAITING_PAYMENT' OR NEW.status NOT IN ('PAID_SIMULATED','PAID') OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Contract snapshot is immutable; settlement advances once';
  END IF;
  IF NEW.status='PAID' AND NOT EXISTS(
   SELECT 1 FROM subscription s JOIN invoice i ON i.subscription_id=s.id
   JOIN enterprise_enrollment e ON e.id=NEW.enrollment_id
   WHERE s.source_order_id=NEW.id AND s.organization_id=e.organization_id
    AND i.organization_id=e.organization_id AND i.kind='INITIAL'
    AND i.status='PAID' AND i.provider='SEPAY' AND NOT i.simulated AND i.amount=NEW.amount
  ) THEN RAISE EXCEPTION 'A real contract settlement requires a matching confirmed SePay invoice'; END IF;
 END IF;
 RETURN NEW;
END $$;

