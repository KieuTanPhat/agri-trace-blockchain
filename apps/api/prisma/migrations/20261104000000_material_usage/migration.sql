ALTER TABLE care_record ADD COLUMN material_id uuid REFERENCES production_material(id), ADD COLUMN material_version integer;
ALTER TABLE care_record ADD CONSTRAINT material_usage_revision CHECK((material_id IS NULL)=(material_version IS NULL));
CREATE FUNCTION guard_care_material() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.material_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_material m JOIN production_cycle c ON c.farm_org_id=m.organization_id WHERE m.id=NEW.material_id AND c.cycle_id=NEW.cycle_id AND m.version=NEW.material_version)
 THEN RAISE EXCEPTION 'Material version or organization mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER care_material_guard BEFORE INSERT ON care_record FOR EACH ROW EXECUTE FUNCTION guard_care_material();
