-- Immutable logical routes and sealed historical import inventory.
-- Required application schema floor; old writers cannot bypass route guards.
BEGIN;
-- Seal the exact preexisting set while writers are blocked. Never infer legacy
-- eligibility from wall-clock timestamps or let a later event opt into it.
LOCK TABLE trace_event IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE ledger_route_legacy_requirement (
  event_id uuid PRIMARY KEY REFERENCES trace_event(event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  data_hash varchar(64) NOT NULL CHECK(data_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
INSERT INTO ledger_route_legacy_requirement(event_id,data_hash)
  SELECT event_id,data_hash FROM trace_event;
CREATE FUNCTION fn_hybrid_legacy_route_requirement_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Legacy route inventory is sealed'; END;
$$;
CREATE TRIGGER trg_hybrid_legacy_route_requirement_sealed BEFORE INSERT OR UPDATE OR DELETE ON ledger_route_legacy_requirement
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_legacy_route_requirement_sealed();
CREATE TABLE ledger_route_import (
  digest varchar(64) PRIMARY KEY CHECK(digest ~ '^[a-f0-9]{64}$'),
  source_sha varchar(40) NOT NULL CHECK(source_sha ~ '^[a-f0-9]{40}$'),
  environment varchar(16) NOT NULL CHECK(environment IN('production','isolated')),
  artifact jsonb NOT NULL CHECK(jsonb_typeof(artifact)='object' AND octet_length(artifact::text)<=1048576),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK((artifact->>'protocol'='agritrace-ledger-route-import/1' AND artifact->>'environment'=environment AND artifact->>'sourceSha'=source_sha) IS TRUE),
  CHECK((jsonb_typeof(artifact->'entries')='array' AND jsonb_array_length(artifact->'entries') BETWEEN 1 AND 1000) IS TRUE)
);
CREATE TRIGGER trg_ledger_route_import_immutable BEFORE UPDATE OR DELETE ON ledger_route_import
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TABLE ledger_route_definition (
  digest varchar(64) PRIMARY KEY CHECK(digest ~ '^[a-f0-9]{64}$'),
  protocol varchar(50) NOT NULL DEFAULT 'agritrace-ledger-route/1' CHECK(protocol='agritrace-ledger-route/1'),
  mode varchar(16) NOT NULL CHECK(mode IN('WRITE','HISTORICAL')),
  network varchar(100) NOT NULL CHECK(network ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  channel_id varchar(100) NOT NULL CHECK(channel_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  chaincode_name varchar(100) NOT NULL CHECK(chaincode_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  contract_name varchar(100) NOT NULL CHECK(contract_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  envelope_version varchar(50),
  writer_authority varchar(100), writer_msp_id varchar(100), writer_role varchar(50),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(writer_authority,writer_msp_id,writer_role) IN(0,3)),
  CHECK(writer_authority IS NULL OR (writer_authority ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' AND writer_msp_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' AND writer_role ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$')),
  CHECK(envelope_version IS NULL OR envelope_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$'),
  CHECK(mode='HISTORICAL' OR (envelope_version IS NOT NULL AND envelope_version='3.0.0' AND writer_authority IS NOT NULL AND writer_msp_id IS NOT NULL AND writer_role IS NOT NULL AND writer_role='relayer'))
);
CREATE TRIGGER trg_ledger_route_definition_immutable BEFORE UPDATE OR DELETE ON ledger_route_definition
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TABLE event_ledger_route (
  event_id uuid PRIMARY KEY REFERENCES trace_event(event_id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  definition_digest varchar(64) NOT NULL REFERENCES ledger_route_definition(digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  import_digest varchar(64) REFERENCES ledger_route_import(digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX ix_event_ledger_route_definition ON event_ledger_route(definition_digest);
CREATE INDEX ix_event_ledger_route_import ON event_ledger_route(import_digest);
CREATE TRIGGER trg_event_ledger_route_immutable BEFORE UPDATE OR DELETE ON event_ledger_route
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

CREATE FUNCTION fn_hybrid_event_route_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e trace_event%ROWTYPE; d ledger_route_definition%ROWTYPE; p ledger_route_definition%ROWTYPE;
BEGIN
  SELECT * INTO STRICT e FROM trace_event WHERE event_id=NEW.event_id;
  SELECT * INTO STRICT d FROM ledger_route_definition WHERE digest=NEW.definition_digest;
  IF EXISTS(SELECT 1 FROM ledger_route_legacy_requirement WHERE event_id=e.event_id) THEN
    IF NEW.import_digest IS NULL OR NOT EXISTS(
      SELECT 1 FROM ledger_route_legacy_requirement r JOIN ledger_route_import i ON i.digest=NEW.import_digest,
        jsonb_array_elements(i.artifact->'entries') entry
      WHERE r.event_id=e.event_id AND r.data_hash=e.data_hash AND entry->>'eventId'=e.event_id::text
        AND entry->>'dataHash'=e.data_hash AND entry->>'definitionDigest'=NEW.definition_digest
    ) THEN RAISE EXCEPTION 'Legacy route requires matching import provenance'; END IF;
  ELSIF NEW.import_digest IS NOT NULL OR d.mode<>'WRITE' THEN
    RAISE EXCEPTION 'New event requires a WRITE route without legacy import';
  END IF;
  IF EXISTS(SELECT 1 FROM blockchain_proof b WHERE b.event_id=e.event_id AND
    (b.network<>d.network OR b.channel_id<>d.channel_id OR b.data_hash<>e.data_hash)) THEN
    RAISE EXCEPTION 'Ledger route conflicts with existing proof';
  END IF;
  IF e.previous_event_hash IS NOT NULL THEN
    IF (SELECT count(*) FROM trace_event predecessor WHERE predecessor.entity_type=e.entity_type AND predecessor.entity_id=e.entity_id AND predecessor.data_hash=e.previous_event_hash)<>1 THEN
      RAISE EXCEPTION 'Ledger predecessor is unresolved or ambiguous';
    END IF;
    SELECT rd.* INTO p FROM trace_event predecessor JOIN event_ledger_route er USING(event_id)
      JOIN ledger_route_definition rd ON rd.digest=er.definition_digest
      WHERE predecessor.entity_type=e.entity_type AND predecessor.entity_id=e.entity_id AND predecessor.data_hash=e.previous_event_hash;
    IF NOT FOUND OR (p.network,p.channel_id,p.chaincode_name,p.contract_name) IS DISTINCT FROM
      (d.network,d.channel_id,d.chaincode_name,d.contract_name) THEN
      RAISE EXCEPTION 'Ledger predecessor route is unresolved or differs';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_event_route_insert BEFORE INSERT ON event_ledger_route
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_event_route_insert();

CREATE FUNCTION fn_hybrid_new_event_requires_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM event_ledger_route WHERE event_id=NEW.event_id) THEN
    RAISE EXCEPTION 'New trace event requires an immutable ledger route';
  END IF;
  RETURN NEW;
END;
$$;
-- Existing legacy rows remain unresolved; only new events are constrained.
CREATE CONSTRAINT TRIGGER trg_hybrid_new_event_requires_route AFTER INSERT ON trace_event
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_hybrid_new_event_requires_route();

CREATE FUNCTION fn_hybrid_proof_matches_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d ledger_route_definition%ROWTYPE; h varchar(64);
BEGIN
  SELECT data_hash INTO h FROM trace_event WHERE event_id=NEW.event_id;
  SELECT rd.* INTO d FROM event_ledger_route er
    JOIN ledger_route_definition rd ON rd.digest=er.definition_digest WHERE er.event_id=NEW.event_id;
  IF NOT FOUND OR (NEW.network,NEW.channel_id,NEW.data_hash) IS DISTINCT FROM (d.network,d.channel_id,h) THEN
    RAISE EXCEPTION 'Proof destination/hash differs from immutable route';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_hybrid_proof_matches_route BEFORE INSERT OR UPDATE ON blockchain_proof
  FOR EACH ROW EXECUTE FUNCTION fn_hybrid_proof_matches_route();
COMMIT;
