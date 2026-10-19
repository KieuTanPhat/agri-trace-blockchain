-- Private rights requests and breach register. No domain/history deletion.
CREATE TABLE platform_privacy_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(10) NOT NULL CHECK (kind IN ('REQUEST', 'BREACH')),
  request_type varchar(20) NOT NULL CHECK (request_type IN ('ACCESS', 'CORRECTION', 'DELETION', 'RESTRICTION', 'WITHDRAWAL', 'OBJECTION', 'INCIDENT')),
  requester_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  payload_ciphertext text NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESPONDED', 'CLOSED', 'REJECTED')),
  reporting varchar(12) NOT NULL DEFAULT 'UNASSESSED' CHECK (reporting IN ('UNASSESSED', 'REQUIRED', 'NOT_REQUIRED')),
  detected_at timestamptz(6),
  deadline_at timestamptz(6),
  reported_at timestamptz(6),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((kind = 'REQUEST' AND request_type <> 'INCIDENT' AND requester_id IS NOT NULL AND detected_at IS NULL AND deadline_at IS NULL AND reported_at IS NULL AND reporting = 'UNASSESSED')
      OR (kind = 'BREACH' AND request_type = 'INCIDENT' AND requester_id IS NULL AND detected_at IS NOT NULL AND deadline_at IS NOT NULL AND deadline_at = detected_at + interval '72 hours')),
  CHECK (reported_at IS NULL OR reported_at >= detected_at),
  CHECK (kind <> 'BREACH' OR status NOT IN ('CLOSED', 'REJECTED') OR reporting = 'NOT_REQUIRED' OR (reporting = 'REQUIRED' AND reported_at IS NOT NULL))
);
CREATE INDEX ix_platform_privacy_requester ON platform_privacy_ticket(requester_id, created_at DESC);
CREATE INDEX ix_platform_privacy_queue ON platform_privacy_ticket(kind, status, deadline_at);
CREATE FUNCTION fn_platform_privacy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Privacy tickets cannot be deleted' USING ERRCODE = '55000'; END IF;
  -- Offline operator rotation may change encryption only, never the evidence.
  IF current_setting('agritrace.platform_key_rotation', true) = 'on'
    AND (to_jsonb(NEW) - 'payload_ciphertext') = (to_jsonb(OLD) - 'payload_ciphertext') THEN RETURN NEW; END IF;
  IF NEW.kind <> OLD.kind OR NEW.request_type <> OLD.request_type OR NEW.requester_id IS DISTINCT FROM OLD.requester_id
    OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.detected_at IS DISTINCT FROM OLD.detected_at
    OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at OR NEW.payload_ciphertext <> OLD.payload_ciphertext
    OR (OLD.reported_at IS NOT NULL AND NEW.reported_at IS DISTINCT FROM OLD.reported_at)
    OR OLD.status IN ('CLOSED','REJECTED') THEN
    RAISE EXCEPTION 'Privacy origin, clock and closed tickets are immutable' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_platform_privacy_guard BEFORE UPDATE OR DELETE ON platform_privacy_ticket FOR EACH ROW EXECUTE FUNCTION fn_platform_privacy_guard();
CREATE TABLE platform_privacy_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES platform_privacy_ticket(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  visibility varchar(8) NOT NULL CHECK (visibility IN ('INTERNAL', 'SHARED')),
  action varchar(20) NOT NULL,
  payload_ciphertext text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX ix_platform_privacy_event_ticket ON platform_privacy_event(ticket_id, created_at);
CREATE FUNCTION fn_platform_privacy_no_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('agritrace.platform_key_rotation', true) = 'on'
      AND (to_jsonb(NEW) - 'payload_ciphertext') = (to_jsonb(OLD) - 'payload_ciphertext') THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Privacy history is append-only' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER trg_platform_privacy_event_immutable BEFORE UPDATE OR DELETE ON platform_privacy_event FOR EACH ROW EXECUTE FUNCTION fn_platform_privacy_no_history_change();
CREATE TRIGGER trg_platform_privacy_event_no_truncate BEFORE TRUNCATE ON platform_privacy_event FOR EACH STATEMENT EXECUTE FUNCTION fn_platform_privacy_no_history_change();
CREATE TRIGGER trg_platform_privacy_ticket_no_truncate BEFORE TRUNCATE ON platform_privacy_ticket FOR EACH STATEMENT EXECUTE FUNCTION fn_platform_privacy_no_history_change();
