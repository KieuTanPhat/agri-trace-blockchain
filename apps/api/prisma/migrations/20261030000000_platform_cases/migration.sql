-- Platform incident / complaint cases (P1-3). A case is a request and a
-- notification to the owning organization; it never changes a Lot (no recall,
-- no state, no quantity). Additive only: new sequence, tables and triggers.

CREATE SEQUENCE platform_case_number_seq;

CREATE TABLE platform_case (
  platform_case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number bigint NOT NULL DEFAULT nextval('platform_case_number_seq'),
  title varchar(200) NOT NULL CHECK (length(btrim(title)) >= 5),
  description text NOT NULL CHECK (length(btrim(description)) >= 10),
  category varchar(20) NOT NULL CHECK (category IN ('QUALITY', 'SAFETY', 'LABELING', 'COUNTERFEIT', 'OTHER')),
  severity varchar(10) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  source varchar(12) NOT NULL CHECK (source IN ('CONSUMER', 'ENTERPRISE', 'AUDITOR', 'INTERNAL')),
  status varchar(14) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ASSIGNED', 'ACKNOWLEDGED', 'RESPONDED', 'ESCALATED', 'CLOSED')),
  lot_id uuid REFERENCES lot(lot_id) ON DELETE RESTRICT,
  owner_organization_id uuid REFERENCES organization(organization_id) ON DELETE RESTRICT,
  response_due_at timestamptz(6),
  acknowledged_at timestamptz(6),
  responded_at timestamptz(6),
  escalated_at timestamptz(6),
  closed_at timestamptz(6),
  close_reason text,
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_platform_case_number UNIQUE (case_number),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CHECK (status <> 'CLOSED' OR length(btrim(COALESCE(close_reason, ''))) >= 10),
  CHECK (status NOT IN ('ASSIGNED', 'ACKNOWLEDGED', 'RESPONDED') OR owner_organization_id IS NOT NULL),
  CHECK (response_due_at IS NULL OR owner_organization_id IS NOT NULL)
);
CREATE INDEX ix_platform_case_status ON platform_case(status, response_due_at);
CREATE INDEX ix_platform_case_owner ON platform_case(owner_organization_id, status) WHERE owner_organization_id IS NOT NULL;
CREATE INDEX ix_platform_case_lot ON platform_case(lot_id) WHERE lot_id IS NOT NULL;

CREATE FUNCTION fn_platform_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'platform_case cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'platform_case is closed and immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.platform_case_id <> OLD.platform_case_id OR NEW.case_number <> OLD.case_number
     OR NEW.source <> OLD.source OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'platform_case identity and origin are immutable' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_platform_case_guard BEFORE UPDATE OR DELETE ON platform_case
  FOR EACH ROW EXECUTE FUNCTION fn_platform_case_guard();

-- Full history: append-only. INTERNAL entries never reach the organization.
CREATE TABLE platform_case_event (
  platform_case_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_case_id uuid NOT NULL REFERENCES platform_case(platform_case_id) ON DELETE RESTRICT,
  action varchar(20) NOT NULL CHECK (action IN (
    'CREATED', 'CLASSIFIED', 'LOT_LINKED', 'ASSIGNED', 'ACKNOWLEDGED',
    'RESPONDED', 'ESCALATED', 'NOTE', 'CLOSED'
  )),
  visibility varchar(8) NOT NULL CHECK (visibility IN ('INTERNAL', 'SHARED')),
  actor_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  actor_organization_id uuid REFERENCES organization(organization_id) ON DELETE RESTRICT,
  note text NOT NULL CHECK (length(btrim(note)) >= 1),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX ix_platform_case_event_case ON platform_case_event(platform_case_id, created_at);

CREATE FUNCTION fn_platform_case_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform_case_event is append-only' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER trg_platform_case_event_no_update_delete BEFORE UPDATE OR DELETE ON platform_case_event
  FOR EACH ROW EXECUTE FUNCTION fn_platform_case_event_immutable();
CREATE TRIGGER trg_platform_case_event_no_truncate BEFORE TRUNCATE ON platform_case_event
  FOR EACH STATEMENT EXECUTE FUNCTION fn_platform_case_event_immutable();
