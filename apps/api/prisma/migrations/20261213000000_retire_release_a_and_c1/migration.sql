-- Release A (unbound global route, envelope 3.0.0 / hash 2.0.0) and the c1
-- signature protocol are retired: every event is a binding (b1) or signed (c2)
-- commitment. History is never rewritten; a database that still holds A or c1
-- rows is refused and must be cleaned or rebuilt by the operator first.
DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM ledger_route_definition
       WHERE protocol <> 'agritrace-ledger-route/2' OR binding_digest IS NULL OR chain_ref IS NULL)
     OR EXISTS (
       SELECT 1 FROM trace_event e
       WHERE NOT EXISTS (SELECT 1 FROM event_binding_context c WHERE c.event_id = e.event_id))
     OR EXISTS (SELECT 1 FROM event_binding_context WHERE commitment_version = 'c1')
     OR EXISTS (SELECT 1 FROM signing_intent WHERE intent->>'protocol' <> 'agritrace-intent/2')
  THEN
    RAISE EXCEPTION 'Release A or c1 rows exist; clean or rebuild this database before migrating';
  END IF;
END $$;

ALTER TABLE ledger_route_definition ADD CONSTRAINT ck_ledger_route_binding_only
  CHECK (protocol = 'agritrace-ledger-route/2' AND binding_digest IS NOT NULL AND chain_ref IS NOT NULL);

ALTER TABLE event_binding_context DROP CONSTRAINT ck_event_binding_commitment;
ALTER TABLE event_binding_context ADD CONSTRAINT ck_event_binding_commitment
  CHECK (commitment_version IN ('b1', 'c2'));

ALTER TABLE trace_event ADD CONSTRAINT ck_trace_event_binding_schema
  CHECK (schema_version IN ('3.0.0', '5.0.0'));
