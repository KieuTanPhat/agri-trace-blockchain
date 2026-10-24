-- P3: processing (transformation) runs. Input lots held by a processor are
-- consumed and new finished lots are created in one audited transaction, with
-- inputs = outputs + by-products + losses (in the run's base unit).
-- Historical harvest lots, their hashes and quantities are untouched.
ALTER TYPE lot_state ADD VALUE IF NOT EXISTS 'CONSUMED';

CREATE TABLE processing_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  chain_id uuid NOT NULL REFERENCES supply_chain(chain_id) ON DELETE RESTRICT,
  site_id uuid NOT NULL,
  process_type varchar(30) NOT NULL
    CHECK (process_type IN ('PRELIMINARY','PACKING','DRYING','FREEZING','MILLING','JUICE_EXTRACT','FERMENTING','OTHER')),
  base_unit varchar(30) NOT NULL,
  recipe varchar(500),
  note varchar(1000),
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','COMPLETED','CANCELLED')),
  origin_cycle_id uuid REFERENCES production_cycle(cycle_id) ON DELETE RESTRICT,
  input_total numeric(14,3),
  output_total numeric(14,3),
  loss_total numeric(14,3),
  variance_percent numeric(9,3),
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  completed_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  completed_at timestamptz(6),
  cancelled_at timestamptz(6),
  cancel_reason varchar(1000),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, organization_id) REFERENCES enterprise_site(id, organization_id) ON DELETE RESTRICT,
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL AND origin_cycle_id IS NOT NULL AND input_total IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE INDEX ix_processing_run_org ON processing_run(organization_id, created_at DESC);
CREATE INDEX ix_processing_run_chain ON processing_run(chain_id, status);

CREATE TABLE processing_input (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES processing_run(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES lot(lot_id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(30) NOT NULL,
  UNIQUE (run_id, lot_id)
);
CREATE INDEX ix_processing_input_lot ON processing_input(lot_id);

CREATE TABLE processing_output (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES processing_run(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  kind varchar(20) NOT NULL CHECK (kind IN ('PRODUCT','BY_PRODUCT')),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(30) NOT NULL,
  base_quantity numeric(14,3) NOT NULL CHECK (base_quantity > 0),
  lot_name varchar(255),
  grade varchar(100),
  packaging varchar(255),
  package_count integer CHECK (package_count > 0),
  expiry_date date,
  lot_id uuid UNIQUE REFERENCES lot(lot_id) ON DELETE RESTRICT
);
CREATE INDEX ix_processing_output_run ON processing_output(run_id);

CREATE TABLE processing_loss (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES processing_run(id) ON DELETE RESTRICT,
  reason varchar(30) NOT NULL
    CHECK (reason IN ('TRIMMING','MOISTURE','SPILLAGE','QUALITY_REJECT','SAMPLING','OTHER')),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  note varchar(500)
);

-- Completed or cancelled runs are immutable records.
CREATE FUNCTION guard_processing_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Processing runs are retained'; END IF;
 IF ROW(NEW.id, NEW.code, NEW.organization_id, NEW.chain_id, NEW.site_id, NEW.process_type, NEW.base_unit, NEW.created_by, NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id, OLD.code, OLD.organization_id, OLD.chain_id, OLD.site_id, OLD.process_type, OLD.base_unit, OLD.created_by, OLD.created_at)
   OR NEW.version <> OLD.version + 1
   OR NOT (OLD.status = 'DRAFT' AND NEW.status IN ('COMPLETED','CANCELLED'))
 THEN RAISE EXCEPTION 'Invalid processing run transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_processing_run_guard BEFORE UPDATE OR DELETE ON processing_run
  FOR EACH ROW EXECUTE FUNCTION guard_processing_run();

CREATE FUNCTION guard_processing_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_status varchar(20);
BEGIN
 SELECT status INTO run_status FROM processing_run
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
 IF TG_OP = 'INSERT' THEN
   IF run_status <> 'DRAFT' THEN RAISE EXCEPTION 'Lines are added only to draft runs'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Processing lines are retained'; END IF;
 -- Only the output line may be linked once to the lot it created.
 IF TG_TABLE_NAME = 'processing_output' AND OLD.lot_id IS NULL AND NEW.lot_id IS NOT NULL
   AND ROW(NEW.run_id, NEW.product_id, NEW.kind, NEW.quantity, NEW.unit, NEW.base_quantity)
     IS NOT DISTINCT FROM ROW(OLD.run_id, OLD.product_id, OLD.kind, OLD.quantity, OLD.unit, OLD.base_quantity)
   AND run_status = 'DRAFT'
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Processing lines are immutable';
END $$;
CREATE TRIGGER trg_processing_input_guard BEFORE INSERT OR UPDATE OR DELETE ON processing_input
  FOR EACH ROW EXECUTE FUNCTION guard_processing_line();
CREATE TRIGGER trg_processing_output_guard BEFORE INSERT OR UPDATE OR DELETE ON processing_output
  FOR EACH ROW EXECUTE FUNCTION guard_processing_line();
CREATE TRIGGER trg_processing_loss_guard BEFORE INSERT OR UPDATE OR DELETE ON processing_loss
  FOR EACH ROW EXECUTE FUNCTION guard_processing_line();

-- Lots now originate from a harvest or from a processing run.
ALTER TABLE lot ADD COLUMN origin_type varchar(20) NOT NULL DEFAULT 'HARVEST'
  CHECK (origin_type IN ('HARVEST','TRANSFORMATION'));
ALTER TABLE lot ADD COLUMN processing_run_id uuid REFERENCES processing_run(id) ON DELETE RESTRICT;
ALTER TABLE lot ALTER COLUMN harvest_id DROP NOT NULL;
ALTER TABLE lot ADD CONSTRAINT ck_lot_origin CHECK (
  (origin_type = 'HARVEST' AND harvest_id IS NOT NULL AND processing_run_id IS NULL) OR
  (origin_type = 'TRANSFORMATION' AND harvest_id IS NULL AND processing_run_id IS NOT NULL));
CREATE INDEX ix_lot_processing_run ON lot(processing_run_id) WHERE processing_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_set_lot_derived_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_id UUID;
    v_farm_org_id UUID;
    v_quantity NUMERIC(14,3);
    v_unit VARCHAR(30);
    v_status VARCHAR(20);
BEGIN
    IF NEW.origin_type = 'TRANSFORMATION' THEN
        SELECT organization_id, status INTO v_farm_org_id, v_status
          FROM public.processing_run WHERE id = NEW.processing_run_id;
        IF NOT FOUND OR v_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'Processed lots are created only while completing a draft processing run';
        END IF;
        IF NEW.farm_org_id IS DISTINCT FROM v_farm_org_id
           OR NEW.available_quantity IS DISTINCT FROM NEW.initial_quantity
           OR NOT EXISTS (
             SELECT 1 FROM public.processing_output o
             WHERE o.run_id = NEW.processing_run_id AND o.lot_id IS NULL
               AND o.product_id = NEW.product_id AND o.quantity = NEW.initial_quantity AND o.unit = NEW.unit) THEN
            RAISE EXCEPTION 'Processed lot must match an unlinked output line of its run';
        END IF;
        NEW.current_state := 'HARVESTED';
        RETURN NEW;
    END IF;

    SELECT pc.product_id,
           pc.farm_org_id,
           he.quantity,
           he.unit
      INTO v_product_id,
           v_farm_org_id,
           v_quantity,
           v_unit
      FROM public.harvest_event he
      JOIN public.production_cycle pc ON pc.cycle_id = he.cycle_id
     WHERE he.harvest_id = NEW.harvest_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'HarvestEvent % does not exist', NEW.harvest_id;
    END IF;

    IF NEW.product_id IS DISTINCT FROM v_product_id
       OR NEW.farm_org_id IS DISTINCT FROM v_farm_org_id
       OR NEW.initial_quantity IS DISTINCT FROM v_quantity
       OR NEW.available_quantity IS DISTINCT FROM v_quantity
       OR NEW.unit IS DISTINCT FROM v_unit THEN
        RAISE EXCEPTION 'Lot fields must match the referenced harvest and production cycle';
    END IF;

    NEW.current_state := 'HARVESTED';
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_lock_lot_origin_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lot_id IS DISTINCT FROM OLD.lot_id OR NEW.harvest_id IS DISTINCT FROM OLD.harvest_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.farm_org_id IS DISTINCT FROM OLD.farm_org_id
    OR NEW.initial_quantity IS DISTINCT FROM OLD.initial_quantity OR NEW.unit IS DISTINCT FROM OLD.unit
    OR NEW.lot_code IS DISTINCT FROM OLD.lot_code OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date
    OR NEW.grade IS DISTINCT FROM OLD.grade OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.origin_type IS DISTINCT FROM OLD.origin_type
    OR NEW.processing_run_id IS DISTINCT FROM OLD.processing_run_id THEN
    RAISE EXCEPTION 'Lot origin, label and expiry fields are immutable after creation';
  END IF;
  RETURN NEW;
END;
$$;

-- A completed run must balance within the configured tolerance and every
-- product output must have produced its lot.
CREATE FUNCTION assert_processing_run_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inputs numeric; outputs numeric; losses numeric; tolerance numeric;
BEGIN
 IF NEW.status <> 'COMPLETED' THEN RETURN NULL; END IF;
 SELECT COALESCE(SUM(quantity),0) INTO inputs FROM processing_input WHERE run_id = NEW.id;
 SELECT COALESCE(SUM(base_quantity),0) INTO outputs FROM processing_output WHERE run_id = NEW.id;
 SELECT COALESCE(SUM(quantity),0) INTO losses FROM processing_loss WHERE run_id = NEW.id;
 SELECT COALESCE((value #>> '{}')::numeric, 0) INTO tolerance FROM platform_setting
   WHERE key = 'processing.massBalanceTolerancePercent';
 IF inputs <= 0 OR abs(inputs - outputs - losses) > inputs * COALESCE(tolerance,0) / 100 THEN
   RAISE EXCEPTION 'Processing mass balance is not reconciled';
 END IF;
 IF EXISTS (SELECT 1 FROM processing_output WHERE run_id = NEW.id AND lot_id IS NULL) THEN
   RAISE EXCEPTION 'Every processing output needs its lot';
 END IF;
 IF NEW.input_total <> inputs OR NEW.output_total <> outputs OR NEW.loss_total <> losses THEN
   RAISE EXCEPTION 'Processing run totals do not match its lines';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_processing_run_balance AFTER UPDATE ON processing_run
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_processing_run_complete();

-- Site kinds accepted by the API also include processing, cold storage and
-- other; the database constraint lagged behind. Processing runs need it.
ALTER TABLE enterprise_site DROP CONSTRAINT enterprise_site_kind_check;
ALTER TABLE enterprise_site ADD CONSTRAINT enterprise_site_kind_check
  CHECK (kind IN ('PRODUCTION','PACKING','WAREHOUSE','COLD_STORAGE','PROCESSING','DISTRIBUTION','RETAIL','OTHER'));

-- Events of a processed lot resolve their chain and ledger binding through the
-- origin cycle recorded on its processing run (harvest lots are unchanged).
CREATE OR REPLACE FUNCTION fn_hybrid_event_context_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_chain uuid; event_cycle uuid; lot_cycle uuid;
BEGIN
  SELECT e.cycle_id, coalesce(h.cycle_id, r.origin_cycle_id) INTO event_cycle, lot_cycle FROM trace_event e
    LEFT JOIN lot l ON l.lot_id = e.lot_id
    LEFT JOIN harvest_event h ON h.harvest_id = l.harvest_id
    LEFT JOIN processing_run r ON r.id = l.processing_run_id
    WHERE e.event_id = NEW.event_id;
  IF event_cycle IS NOT NULL AND lot_cycle IS NOT NULL AND event_cycle <> lot_cycle THEN
    RAISE EXCEPTION 'Event subjects disagree';
  END IF;
  SELECT chain_id INTO subject_chain FROM production_cycle WHERE cycle_id = coalesce(event_cycle, lot_cycle);
  IF subject_chain IS DISTINCT FROM NEW.chain_id THEN RAISE EXCEPTION 'Event context chain mismatch'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_b_event_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle_binding varchar(64); event_cycle uuid;
BEGIN
  SELECT coalesce(e.cycle_id, h.cycle_id, r.origin_cycle_id) INTO event_cycle FROM trace_event e
    LEFT JOIN lot l ON l.lot_id = e.lot_id
    LEFT JOIN harvest_event h ON h.harvest_id = l.harvest_id
    LEFT JOIN processing_run r ON r.id = l.processing_run_id
    WHERE e.event_id = NEW.event_id;
  SELECT binding_digest INTO cycle_binding FROM cycle_ledger_context WHERE cycle_id = event_cycle;
  IF cycle_binding IS DISTINCT FROM NEW.binding_digest THEN
    RAISE EXCEPTION 'Event binding differs from its cycle origin binding';
  END IF;
  RETURN NEW;
END;
$$;
