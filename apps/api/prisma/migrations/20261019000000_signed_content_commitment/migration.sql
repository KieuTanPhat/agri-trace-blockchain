-- c1 hashes and historical rows remain immutable. Only new c2 signed writes
-- are admitted; a pending legacy command must be reconciled, never rehashed.
ALTER TABLE event_binding_context DROP CONSTRAINT ck_event_binding_commitment;
ALTER TABLE event_binding_context ADD CONSTRAINT ck_event_binding_commitment
  CHECK (commitment_version IN ('b1', 'c1', 'c2'));

CREATE OR REPLACE FUNCTION fn_c_event_signature_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i signing_intent%ROWTYPE; ctx event_binding_context%ROWTYPE; e trace_event%ROWTYPE;
BEGIN
  SELECT * INTO i FROM signing_intent WHERE intent_id = NEW.intent_id;
  SELECT * INTO ctx FROM event_binding_context WHERE event_id = NEW.event_id;
  SELECT * INTO e FROM trace_event WHERE event_id = NEW.event_id;
  IF i.status IS DISTINCT FROM 'CONSUMED' OR i.event_id IS DISTINCT FROM NEW.event_id
     OR i.intent_digest IS DISTINCT FROM NEW.intent_digest OR i.key_ref IS DISTINCT FROM NEW.key_ref
     OR i.binding_digest IS DISTINCT FROM NEW.binding_digest OR i.organization_id IS DISTINCT FROM NEW.organization_id
     OR i.signature IS DISTINCT FROM NEW.signature THEN
    RAISE EXCEPTION 'Event signature must restate its consumed intent';
  END IF;
  IF ctx.commitment_version IS DISTINCT FROM 'c2' OR ctx.binding_digest IS DISTINCT FROM NEW.binding_digest
     OR e.schema_version IS DISTINCT FROM '5.0.0' THEN
    RAISE EXCEPTION 'New signed events need a c2 binding context and schema 5.0.0';
  END IF;
  IF e.entity_type IS DISTINCT FROM i.entity_type OR e.entity_id IS DISTINCT FROM i.entity_id
     OR e.event_type IS DISTINCT FROM i.event_type OR e.actor_organization_id IS DISTINCT FROM i.organization_id
     OR i.intent->>'protocol' IS DISTINCT FROM 'agritrace-intent/2'
     OR i.intent->>'payloadDigest' IS DISTINCT FROM i.payload_digest
     OR (e.business_data - ARRAY['actorSignature', 'chainId', 'scopeVersion']) IS DISTINCT FROM i.payload
     OR e.business_data->>'chainId' IS DISTINCT FROM i.chain_id::text
     OR e.business_data->'scopeVersion' IS DISTINCT FROM '1'::jsonb
     OR e.business_data->'actorSignature' IS DISTINCT FROM jsonb_build_object(
       'intent', i.intent, 'payload', i.payload, 'signerOrgId', i.organization_id::text,
       'assertion', jsonb_build_object('algorithm', 'Ed25519', 'keyRef', i.key_ref::text,
         'intentDigest', i.intent_digest, 'signature', i.signature, 'payloadDigest', i.payload_digest)) THEN
    RAISE EXCEPTION 'Signed event business content differs from its consumed intent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_c_context_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.commitment_version = 'c1' THEN
    RAISE EXCEPTION 'New c1 signed writes are disabled; reconcile legacy commands';
  END IF;
  IF (NEW.commitment_version = 'c2') <> EXISTS (SELECT 1 FROM event_actor_signature s WHERE s.event_id = NEW.event_id) THEN
    RAISE EXCEPTION 'A c2 binding context needs exactly one event signature (and b1 none)';
  END IF;
  RETURN NULL;
END;
$$;
