-- Processing and distribution reserve the same authoritative organization/site
-- holdings. Count both promises, including inputs from another source chain.
-- Do not rewrite historical rows or relax physical/custody reconciliation.
CREATE OR REPLACE FUNCTION assert_distribution_balance_for(lid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE physical numeric; expected numeric; actor record; promised numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM lot_holding WHERE lot_id=lid) THEN RETURN; END IF;
 SELECT available_quantity INTO expected FROM lot WHERE lot_id=lid FOR UPDATE;
 SELECT COALESCE(SUM(quantity),0) INTO physical FROM lot_holding WHERE lot_id=lid;
 SELECT physical+COALESCE(SUM(l.quantity),0) INTO physical FROM distribution_line l
   JOIN distribution_transfer t ON t.id=l.transfer_id WHERE l.lot_id=lid AND t.status='IN_TRANSIT';
 SELECT physical+COALESCE(SUM(quantity),0) INTO physical FROM distribution_remainder WHERE lot_id=lid;
 IF physical<>expected THEN RAISE EXCEPTION 'Distribution quantity is not reconciled'; END IF;
 FOR actor IN SELECT organization_id,quantity,reserved FROM lot_holding WHERE lot_id=lid LOOP
   SELECT COALESCE(SUM(l.quantity),0) INTO promised FROM distribution_line l
     JOIN distribution_transfer t ON t.id=l.transfer_id
     WHERE l.lot_id=lid AND t.sender_id=actor.organization_id AND t.status IN ('PROPOSED','READY');
   SELECT promised+COALESCE(SUM(i.quantity),0) INTO promised FROM processing_input i
     JOIN processing_run r ON r.id=i.run_id
     WHERE i.lot_id=lid AND r.organization_id=actor.organization_id AND r.status='IN_PROGRESS';
   IF actor.reserved<>promised THEN RAISE EXCEPTION 'Distribution reservation is not reconciled'; END IF;
   IF (SELECT COALESCE(SUM(quantity),0) FROM lot_site_holding WHERE lot_id=lid AND organization_id=actor.organization_id)>actor.quantity
    OR (SELECT COALESCE(SUM(reserved),0) FROM lot_site_holding WHERE lot_id=lid AND organization_id=actor.organization_id)>actor.reserved
   THEN RAISE EXCEPTION 'Site allocation exceeds organization balance'; END IF;
 END LOOP;
 FOR actor IN SELECT * FROM lot_site_holding WHERE lot_id=lid LOOP
   SELECT COALESCE(SUM(l.quantity),0) INTO promised FROM distribution_line l
     JOIN distribution_transfer t ON t.id=l.transfer_id
     WHERE l.lot_id=lid AND t.sender_id=actor.organization_id AND t.sender_site_id=actor.site_id AND t.status IN ('PROPOSED','READY');
   SELECT promised+COALESCE(SUM(i.quantity),0) INTO promised FROM processing_input i
     JOIN processing_run r ON r.id=i.run_id
     WHERE i.lot_id=lid AND r.organization_id=actor.organization_id AND r.site_id=actor.site_id AND r.status='IN_PROGRESS';
   IF actor.reserved<>promised THEN RAISE EXCEPTION 'Site reservation is not reconciled'; END IF;
 END LOOP;
END $$;

-- A status/line change must not silently leave a different amount reserved,
-- even when a caller changes the promise without touching the holding rows.
CREATE FUNCTION assert_processing_reservation_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid uuid;
BEGIN
 IF TG_TABLE_NAME='processing_run' THEN
   FOR lid IN SELECT lot_id FROM processing_input WHERE run_id=NEW.id ORDER BY lot_id LOOP
     PERFORM assert_distribution_balance_for(lid);
   END LOOP;
 ELSE
   lid := CASE WHEN TG_OP='DELETE' THEN OLD.lot_id ELSE NEW.lot_id END;
   PERFORM assert_distribution_balance_for(lid);
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER processing_run_reservation_balance AFTER INSERT OR UPDATE ON processing_run
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_processing_reservation_balance();
CREATE CONSTRAINT TRIGGER processing_input_reservation_balance AFTER INSERT OR UPDATE OR DELETE ON processing_input
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_processing_reservation_balance();

-- Existing inconsistencies stop migration rather than being adjusted or hidden.
DO $$
DECLARE lid uuid;
BEGIN
 FOR lid IN SELECT DISTINCT lot_id FROM lot_holding ORDER BY lot_id LOOP
   PERFORM assert_distribution_balance_for(lid);
 END LOOP;
END $$;
