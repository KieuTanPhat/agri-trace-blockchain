-- Deferred constraints see the complete transaction, including all transfer lines.
CREATE FUNCTION assert_distribution_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid uuid; physical numeric; expected numeric; reserved_total numeric; reserved_expected numeric;
BEGIN
 IF TG_TABLE_NAME='distribution_transfer' THEN
   FOR lid IN SELECT lot_id FROM distribution_line WHERE transfer_id=NEW.id ORDER BY lot_id LOOP
     PERFORM assert_distribution_balance_for(lid);
   END LOOP;
 ELSE
   lid := NEW.lot_id;
   PERFORM assert_distribution_balance_for(lid);
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION assert_distribution_balance_for(lid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE physical numeric; expected numeric; actor record; promised numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM lot_holding WHERE lot_id=lid) THEN RETURN; END IF;
 SELECT available_quantity INTO expected FROM lot WHERE lot_id=lid FOR UPDATE;
 SELECT COALESCE(SUM(quantity),0) INTO physical FROM lot_holding WHERE lot_id=lid;
 SELECT physical+COALESCE(SUM(l.quantity),0) INTO physical FROM distribution_line l
   JOIN distribution_transfer t ON t.id=l.transfer_id WHERE l.lot_id=lid AND t.status='IN_TRANSIT';
 IF physical<>expected THEN RAISE EXCEPTION 'Distribution quantity is not reconciled'; END IF;
 FOR actor IN SELECT organization_id,reserved FROM lot_holding WHERE lot_id=lid LOOP
   SELECT COALESCE(SUM(l.quantity),0) INTO promised FROM distribution_line l JOIN distribution_transfer t ON t.id=l.transfer_id
     WHERE l.lot_id=lid AND t.sender_id=actor.organization_id AND t.status IN ('PROPOSED','READY');
   IF actor.reserved<>promised THEN RAISE EXCEPTION 'Distribution reservation is not reconciled'; END IF;
 END LOOP;
END $$;
CREATE CONSTRAINT TRIGGER distribution_holding_balance AFTER INSERT OR UPDATE ON lot_holding DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_distribution_balance();
CREATE CONSTRAINT TRIGGER distribution_line_balance AFTER INSERT ON distribution_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_distribution_balance();
CREATE CONSTRAINT TRIGGER distribution_transfer_balance AFTER UPDATE ON distribution_transfer DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_distribution_balance();
CREATE CONSTRAINT TRIGGER distribution_lot_balance AFTER UPDATE ON lot DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_distribution_balance();

CREATE FUNCTION guard_enterprise_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE supervisor app_user%ROWTYPE;
BEGIN
 IF NEW.enterprise_tier IN (2,3) THEN
   SELECT * INTO supervisor FROM app_user WHERE user_id=NEW.supervisor_id FOR SHARE;
   IF NOT FOUND OR supervisor.organization_id IS DISTINCT FROM NEW.organization_id
     OR supervisor.enterprise_tier IS NULL OR supervisor.enterprise_tier>=NEW.enterprise_tier
   THEN RAISE EXCEPTION 'Invalid enterprise hierarchy'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.enterprise_tier,NEW.supervisor_id) IS DISTINCT FROM (OLD.enterprise_tier,OLD.supervisor_id)
 THEN RAISE EXCEPTION 'Enterprise hierarchy requires an explicit ownership transfer'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enterprise_hierarchy_guard BEFORE INSERT OR UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION guard_enterprise_hierarchy();
CREATE FUNCTION guard_enterprise_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.permissions <@ ARRAY['profile.read','members.read','members.manage','roles.manage','partners.read','partners.manage','catalog.read','catalog.manage','sites.read','sites.manage','vehicles.read','vehicles.manage','production.read','production.write','distribution.read','distribution.write','distribution.sign','trace.read','qr.manage','reports.read']::text[]
 THEN RAISE EXCEPTION 'Unknown enterprise permission'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enterprise_role_permission_guard BEFORE INSERT OR UPDATE ON enterprise_role FOR EACH ROW EXECUTE FUNCTION guard_enterprise_role_permissions();
