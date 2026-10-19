ALTER TABLE distribution_transfer ADD COLUMN sender_site_id uuid REFERENCES enterprise_site(id),
 ADD COLUMN carrier_site_id uuid REFERENCES enterprise_site(id), ADD COLUMN receiver_site_id uuid REFERENCES enterprise_site(id);
CREATE TABLE trace_notice (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lot_id uuid NOT NULL REFERENCES lot(lot_id),
 organization_id uuid NOT NULL REFERENCES organization(organization_id), kind varchar(20) NOT NULL CHECK(kind IN ('WARNING','RECALL')),
 message varchar(500) NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX trace_notice_lot ON trace_notice(lot_id);
CREATE TABLE distribution_observation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL REFERENCES distribution_transfer(id),
 organization_id uuid NOT NULL REFERENCES organization(organization_id), event_time timestamptz(6) NOT NULL,
 note varchar(1000) NOT NULL, temperature numeric(6,2), created_at timestamptz(6) NOT NULL DEFAULT now(),
 CHECK(temperature IS NULL OR temperature BETWEEN -100 AND 100)
);
CREATE INDEX distribution_observation_transfer ON distribution_observation(transfer_id,event_time);
CREATE TRIGGER trace_notice_immutable BEFORE UPDATE OR DELETE ON trace_notice FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE TRIGGER distribution_observation_immutable BEFORE UPDATE OR DELETE ON distribution_observation FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE FUNCTION guard_distribution_sites() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pair record;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.sender_site_id,NEW.carrier_site_id,NEW.receiver_site_id) IS DISTINCT FROM ROW(OLD.sender_site_id,OLD.carrier_site_id,OLD.receiver_site_id)
 THEN RAISE EXCEPTION 'Transfer facility snapshot is immutable'; END IF;
 IF TG_OP='INSERT' THEN
   FOR pair IN SELECT * FROM (VALUES(NEW.sender_site_id,NEW.sender_id),(NEW.carrier_site_id,NEW.carrier_id),(NEW.receiver_site_id,NEW.receiver_id)) AS x(site_id,org_id) LOOP
     IF pair.site_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM enterprise_site WHERE id=pair.site_id AND organization_id=pair.org_id AND status='ACTIVE')
     THEN RAISE EXCEPTION 'Transfer facility must belong to the corresponding active enterprise'; END IF;
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_facility_guard BEFORE INSERT OR UPDATE ON distribution_transfer FOR EACH ROW EXECUTE FUNCTION guard_distribution_sites();
