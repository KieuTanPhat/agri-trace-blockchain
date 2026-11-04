-- A started processing or packing run reserves its input lots at the site
-- (processing.service reserve). The reservation balance only counted transfer
-- lines, so starting a run on a lot received through a handover failed with
-- "Distribution reservation is not reconciled". Count IN_PROGRESS run inputs too.
CREATE OR REPLACE FUNCTION assert_distribution_balance_for(lid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE physical numeric; expected numeric; actor record; promised numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM lot_holding WHERE lot_id=lid) THEN RETURN; END IF;
 SELECT available_quantity INTO expected FROM lot WHERE lot_id=lid FOR UPDATE;
 SELECT COALESCE(SUM(quantity),0) INTO physical FROM lot_holding WHERE lot_id=lid;
 SELECT physical+COALESCE(SUM(l.quantity),0) INTO physical FROM distribution_line l JOIN distribution_transfer t ON t.id=l.transfer_id WHERE l.lot_id=lid AND t.status='IN_TRANSIT';
 SELECT physical+COALESCE(SUM(quantity),0) INTO physical FROM distribution_remainder WHERE lot_id=lid;
 IF physical<>expected THEN RAISE EXCEPTION 'Distribution quantity is not reconciled'; END IF;
 FOR actor IN SELECT organization_id,quantity,reserved FROM lot_holding WHERE lot_id=lid LOOP
   SELECT COALESCE(SUM(l.quantity),0) INTO promised FROM distribution_line l JOIN distribution_transfer t ON t.id=l.transfer_id WHERE l.lot_id=lid AND t.sender_id=actor.organization_id AND t.status IN ('PROPOSED','READY');
   SELECT promised+COALESCE(SUM(i.quantity),0) INTO promised FROM processing_input i JOIN processing_run r ON r.id=i.run_id WHERE i.lot_id=lid AND r.organization_id=actor.organization_id AND r.status='IN_PROGRESS';
   IF actor.reserved<>promised THEN RAISE EXCEPTION 'Distribution reservation is not reconciled'; END IF;
   IF (SELECT COALESCE(SUM(quantity),0) FROM lot_site_holding WHERE lot_id=lid AND organization_id=actor.organization_id)>actor.quantity
    OR (SELECT COALESCE(SUM(reserved),0) FROM lot_site_holding WHERE lot_id=lid AND organization_id=actor.organization_id)>actor.reserved
   THEN RAISE EXCEPTION 'Site allocation exceeds organization balance'; END IF;
 END LOOP;
 FOR actor IN SELECT * FROM lot_site_holding WHERE lot_id=lid LOOP
   SELECT COALESCE(SUM(l.quantity),0) INTO promised FROM distribution_line l JOIN distribution_transfer t ON t.id=l.transfer_id WHERE l.lot_id=lid AND t.sender_id=actor.organization_id AND t.sender_site_id=actor.site_id AND t.status IN ('PROPOSED','READY');
   SELECT promised+COALESCE(SUM(i.quantity),0) INTO promised FROM processing_input i JOIN processing_run r ON r.id=i.run_id WHERE i.lot_id=lid AND r.organization_id=actor.organization_id AND r.site_id=actor.site_id AND r.status='IN_PROGRESS';
   IF actor.reserved<>promised THEN RAISE EXCEPTION 'Site reservation is not reconciled'; END IF;
 END LOOP;
END $$;
