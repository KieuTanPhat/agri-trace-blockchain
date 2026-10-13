-- Fresh-install cleanup is append-only; release A/B/C checksums stay immutable.
-- This migration never removes or rewrites existing business history.
BEGIN;
LOCK TABLE production_cycle, harvest_event, lot, shipment, trace_event,
  blockchain_outbox, ledger_route_definition IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM production_cycle) OR EXISTS (SELECT 1 FROM harvest_event)
    OR EXISTS (SELECT 1 FROM lot) OR EXISTS (SELECT 1 FROM shipment)
    OR EXISTS (SELECT 1 FROM trace_event) OR EXISTS (SELECT 1 FROM blockchain_outbox)
    OR EXISTS (SELECT 1 FROM ledger_route_exemption)
    OR EXISTS (SELECT 1 FROM ledger_route_definition WHERE mode <> 'WRITE') THEN
    RAISE EXCEPTION 'Hybrid fresh install requires an empty business database; existing data must be preserved';
  END IF;
END;
$$;
ALTER TABLE ledger_route_definition DROP CONSTRAINT ledger_route_definition_mode_check;
ALTER TABLE ledger_route_definition ADD CONSTRAINT ledger_route_definition_write_only CHECK (mode = 'WRITE');
CREATE OR REPLACE FUNCTION fn_hybrid_event_route_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e trace_event%ROWTYPE; d ledger_route_definition%ROWTYPE; p ledger_route_definition%ROWTYPE;
  predecessor uuid;
BEGIN
  SELECT * INTO STRICT e FROM trace_event WHERE event_id = NEW.event_id;
  SELECT * INTO STRICT d FROM ledger_route_definition WHERE digest = NEW.definition_digest;
  IF d.mode <> 'WRITE' THEN
    RAISE EXCEPTION 'Only a WRITE route can be assigned to an event';
  END IF;
  IF e.previous_event_hash IS NOT NULL THEN
    IF (SELECT count(*) FROM trace_event t WHERE t.entity_type = e.entity_type
        AND t.entity_id = e.entity_id AND t.data_hash = e.previous_event_hash) <> 1 THEN
      RAISE EXCEPTION 'Ledger predecessor is unresolved or ambiguous';
    END IF;
    SELECT t.event_id INTO predecessor FROM trace_event t WHERE t.entity_type = e.entity_type
      AND t.entity_id = e.entity_id AND t.data_hash = e.previous_event_hash;
    SELECT rd.* INTO p FROM event_ledger_route er JOIN ledger_route_definition rd ON rd.digest = er.definition_digest
      WHERE er.event_id = predecessor;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ledger predecessor has no route';
    END IF;
    IF (p.network, p.channel_id, p.chaincode_name, p.contract_name) IS DISTINCT FROM
      (d.network, d.channel_id, d.chaincode_name, d.contract_name) THEN
      RAISE EXCEPTION 'Ledger predecessor route differs';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_hybrid_new_event_requires_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM event_ledger_route WHERE event_id = NEW.event_id) THEN
    RAISE EXCEPTION 'New trace event requires an immutable ledger route';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM event_chain_context WHERE event_id = NEW.event_id)
    AND coalesce(NEW.cycle_id, NEW.lot_id) IS NOT NULL THEN
    RAISE EXCEPTION 'New trace event requires a chain context';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_hybrid_proof_matches_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d ledger_route_definition%ROWTYPE; h varchar(64);
BEGIN
  SELECT rd.* INTO d FROM event_ledger_route er
    JOIN ledger_route_definition rd ON rd.digest = er.definition_digest WHERE er.event_id = NEW.event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proof requires the event ledger route';
  END IF;
  SELECT data_hash INTO h FROM trace_event WHERE event_id = NEW.event_id;
  IF (NEW.network, NEW.channel_id, NEW.data_hash) IS DISTINCT FROM (d.network, d.channel_id, h) THEN
    RAISE EXCEPTION 'Proof destination/hash differs from immutable route';
  END IF;
  RETURN NEW;
END;
$$;
DROP TABLE ledger_route_exemption;
DROP FUNCTION fn_hybrid_route_exemption_sealed();
COMMIT;
