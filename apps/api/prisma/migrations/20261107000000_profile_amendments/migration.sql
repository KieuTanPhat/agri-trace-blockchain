ALTER TABLE enterprise_profile ADD COLUMN legal_data jsonb NOT NULL DEFAULT '{}';
CREATE TABLE enterprise_profile_amendment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 creator_id uuid NOT NULL REFERENCES app_user(user_id), profile_version integer NOT NULL, organization_version integer NOT NULL,
 target jsonb NOT NULL, evidence_ids uuid[] NOT NULL, reason varchar(1000) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
 version integer NOT NULL DEFAULT 0, review_note varchar(1000), reviewed_by uuid REFERENCES app_user(user_id),
 created_at timestamptz(6) NOT NULL DEFAULT now(), reviewed_at timestamptz(6),
 CHECK((status IN ('APPROVED','REJECTED'))=(reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_note IS NOT NULL))
);
CREATE INDEX enterprise_profile_amendment_org ON enterprise_profile_amendment(organization_id);
CREATE UNIQUE INDEX enterprise_profile_one_pending ON enterprise_profile_amendment(organization_id) WHERE status='PENDING';
CREATE FUNCTION guard_profile_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Profile amendment history is immutable'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.creator_id,NEW.profile_version,NEW.organization_version,NEW.target,NEW.evidence_ids,NEW.reason,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.creator_id,OLD.profile_version,OLD.organization_version,OLD.target,OLD.evidence_ids,OLD.reason,OLD.created_at)
 OR OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED','WITHDRAWN') OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid profile review transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profile_amendment_guard BEFORE UPDATE OR DELETE ON enterprise_profile_amendment FOR EACH ROW EXECUTE FUNCTION guard_profile_amendment();
CREATE FUNCTION guard_reviewed_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM enterprise_revision WHERE entity_type='PROFILE' AND entity_id=OLD.organization_id AND version=OLD.version)
 THEN RAISE EXCEPTION 'Profile changes require a versioned history'; END IF;
 IF (NEW.legal_form,NEW.address,NEW.province,NEW.province_code,NEW.ward,NEW.ward_code,NEW.representative,NEW.activities,NEW.legal_data)
 IS DISTINCT FROM (OLD.legal_form,OLD.address,OLD.province,OLD.province_code,OLD.ward,OLD.ward_code,OLD.representative,OLD.activities,OLD.legal_data)
 AND NOT EXISTS(SELECT 1 FROM enterprise_profile_amendment a WHERE a.organization_id=OLD.organization_id AND a.profile_version=OLD.version AND a.status='APPROVED'
 AND a.target @> jsonb_build_object('legalForm',NEW.legal_form,'address',NEW.address,'province',NEW.province,'provinceCode',NEW.province_code,'ward',NEW.ward,'wardCode',NEW.ward_code,'representative',NEW.representative,'activities',to_jsonb(NEW.activities),'legalData',NEW.legal_data))
 THEN RAISE EXCEPTION 'Legal information and capabilities require an approved amendment'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewed_profile_guard BEFORE UPDATE ON enterprise_profile FOR EACH ROW EXECUTE FUNCTION guard_reviewed_profile();
CREATE OR REPLACE FUNCTION guard_enterprise_enrollment_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Enrollment history is immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR (NEW.id,NEW.organization_id,NEW.owner_id,NEW.registration_digest,NEW.business_id,NEW.hosting_mode) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.owner_id,OLD.registration_digest,OLD.business_id,OLD.hosting_mode)
 THEN RAISE EXCEPTION 'Enrollment identity or version mismatch'; END IF;
 IF OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED') AND NEW.service_activated_at IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='APPROVED' AND NEW.status='APPROVED' AND OLD.service_activated_at IS NULL AND NEW.service_activated_at IS NOT NULL THEN RETURN NEW; END IF;
 IF OLD.status='REJECTED' AND NEW.status='PENDING_REVIEW' AND NEW.service_activated_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.review_note IS NULL
 AND EXISTS(SELECT 1 FROM enterprise_profile_amendment a JOIN enterprise_profile p ON p.organization_id=a.organization_id WHERE a.organization_id=OLD.organization_id AND a.status='APPROVED' AND a.profile_version=p.version-1)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Invalid enrollment transition';
END $$;
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_entity_type_check;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_entity_type_check CHECK(entity_type IN ('PRODUCT','SITE','CYCLE','LOT','TRANSFER','MATERIAL','PROFILE'));
