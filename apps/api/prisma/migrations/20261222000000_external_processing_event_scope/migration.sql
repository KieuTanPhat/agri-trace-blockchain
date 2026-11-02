-- External-material processing has no production-cycle origin. Its immutable
-- run pins a chain and binding; harvested and cycle-derived lots keep their
-- original cycle context. No existing events, hashes or contexts are changed.
CREATE OR REPLACE FUNCTION fn_hybrid_event_context_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  subject_chain uuid;
  event_cycle uuid;
  lot_cycle uuid;
  processing_chain uuid;
BEGIN
  SELECT e.cycle_id, coalesce(h.cycle_id, r.origin_cycle_id), r.chain_id
    INTO event_cycle, lot_cycle, processing_chain
    FROM trace_event e
    LEFT JOIN lot l ON l.lot_id = e.lot_id
    LEFT JOIN harvest_event h ON h.harvest_id = l.harvest_id
    LEFT JOIN processing_run r ON r.id = l.processing_run_id
    WHERE e.event_id = NEW.event_id;
  IF (event_cycle IS NOT NULL AND lot_cycle IS NOT NULL AND event_cycle <> lot_cycle)
     OR (processing_chain IS NOT NULL AND lot_cycle IS NULL AND event_cycle IS NOT NULL) THEN
    RAISE EXCEPTION 'Event subjects disagree';
  END IF;
  SELECT chain_id INTO subject_chain FROM production_cycle
    WHERE cycle_id = coalesce(event_cycle, lot_cycle);
  IF processing_chain IS NOT NULL AND subject_chain IS NOT NULL AND processing_chain <> subject_chain THEN
    RAISE EXCEPTION 'Event subjects disagree';
  END IF;
  subject_chain := coalesce(subject_chain, processing_chain);
  IF subject_chain IS NULL OR subject_chain IS DISTINCT FROM NEW.chain_id THEN
    RAISE EXCEPTION 'Event context chain mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_b_event_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_binding varchar(64);
  run_binding varchar(64);
  event_cycle uuid;
  lot_cycle uuid;
  processing_chain uuid;
  binding_chain uuid;
BEGIN
  SELECT e.cycle_id, coalesce(h.cycle_id, r.origin_cycle_id), r.chain_id, r.binding_digest
    INTO event_cycle, lot_cycle, processing_chain, run_binding
    FROM trace_event e
    LEFT JOIN lot l ON l.lot_id = e.lot_id
    LEFT JOIN harvest_event h ON h.harvest_id = l.harvest_id
    LEFT JOIN processing_run r ON r.id = l.processing_run_id
    WHERE e.event_id = NEW.event_id;
  IF (event_cycle IS NOT NULL AND lot_cycle IS NOT NULL AND event_cycle <> lot_cycle)
     OR (processing_chain IS NOT NULL AND lot_cycle IS NULL AND event_cycle IS NOT NULL) THEN
    RAISE EXCEPTION 'Event subjects disagree';
  END IF;
  IF coalesce(event_cycle, lot_cycle) IS NOT NULL THEN
    SELECT binding_digest INTO expected_binding FROM cycle_ledger_context
      WHERE cycle_id = coalesce(event_cycle, lot_cycle);
  ELSE
    expected_binding := run_binding;
  END IF;
  IF expected_binding IS NULL OR expected_binding IS DISTINCT FROM NEW.binding_digest THEN
    RAISE EXCEPTION 'Event binding differs from its cycle origin binding or pinned processing binding';
  END IF;
  SELECT chain_id INTO binding_chain FROM fabric_network_binding WHERE digest = expected_binding;
  IF binding_chain IS NULL OR (processing_chain IS NOT NULL AND processing_chain <> binding_chain) THEN
    RAISE EXCEPTION 'Event processing chain differs from its pinned binding';
  END IF;
  RETURN NEW;
END;
$$;
