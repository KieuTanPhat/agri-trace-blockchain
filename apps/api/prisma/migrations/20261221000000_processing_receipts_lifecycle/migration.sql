-- Processing receipts and run lifecycle (27/10/2026).
-- * material_receipt: goods received at a processing site, from an AgriTrace
--   handover (stock stays on lot_site_holding) or declared from outside
--   (stock is tracked on the receipt itself).
-- * processing_run: one main product, DRAFT (plan) -> IN_PROGRESS (inputs
--   reserved, log open) -> COMPLETED (single output); a run fed only by
--   external material keeps the chain binding it was planned under.
-- Completed runs, lots, hashes and quantities already recorded are untouched.

CREATE TABLE material_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES enterprise_site(id) ON DELETE RESTRICT,
  source varchar(20) NOT NULL CHECK (source IN ('AGRITRACE','EXTERNAL')),
  transfer_id uuid REFERENCES distribution_transfer(id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES lot(lot_id) ON DELETE RESTRICT,
  material_name varchar(255) NOT NULL,
  supplier_name varchar(255) NOT NULL,
  document_no varchar(100),
  received_at timestamptz(6) NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(30) NOT NULL,
  reserved numeric(14,3) NOT NULL DEFAULT 0,
  consumed numeric(14,3) NOT NULL DEFAULT 0,
  expiry_date date,
  note varchar(1000),
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((source = 'AGRITRACE') = (transfer_id IS NOT NULL AND lot_id IS NOT NULL)),
  CHECK (source = 'EXTERNAL' OR (reserved = 0 AND consumed = 0)),
  CHECK (reserved >= 0 AND consumed >= 0 AND reserved + consumed <= quantity)
);
CREATE UNIQUE INDEX uq_material_receipt_transfer_lot ON material_receipt(transfer_id, lot_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX ix_material_receipt_org_site ON material_receipt(organization_id, site_id, created_at DESC);

-- A receipt is a document: only the external stock counters move.
CREATE FUNCTION guard_material_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Material receipts are retained'; END IF;
 IF ROW(NEW.id, NEW.code, NEW.organization_id, NEW.site_id, NEW.source, NEW.transfer_id, NEW.lot_id,
        NEW.material_name, NEW.supplier_name, NEW.document_no, NEW.received_at, NEW.quantity, NEW.unit,
        NEW.expiry_date, NEW.note, NEW.created_by, NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id, OLD.code, OLD.organization_id, OLD.site_id, OLD.source, OLD.transfer_id, OLD.lot_id,
        OLD.material_name, OLD.supplier_name, OLD.document_no, OLD.received_at, OLD.quantity, OLD.unit,
        OLD.expiry_date, OLD.note, OLD.created_by, OLD.created_at)
   OR NEW.version <> OLD.version + 1 OR NEW.consumed < OLD.consumed
 THEN RAISE EXCEPTION 'Material receipts are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_material_receipt_guard BEFORE UPDATE OR DELETE ON material_receipt
  FOR EACH ROW EXECUTE FUNCTION guard_material_receipt();

-- Run lifecycle.
ALTER TABLE processing_run ADD COLUMN product_id uuid REFERENCES product(product_id) ON DELETE RESTRICT;
ALTER TABLE processing_run ADD COLUMN binding_digest varchar(64);
ALTER TABLE processing_run ADD COLUMN started_at timestamptz(6);
ALTER TABLE processing_run ADD COLUMN started_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'processing_run'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE processing_run DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE processing_run ADD CONSTRAINT ck_processing_run_status
  CHECK (status IN ('DRAFT','IN_PROGRESS','COMPLETED','CANCELLED'));
ALTER TABLE processing_run ADD CONSTRAINT ck_processing_run_completed
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL AND input_total IS NOT NULL));
ALTER TABLE processing_run ADD CONSTRAINT ck_processing_run_cancelled
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));
ALTER TABLE processing_run ADD CONSTRAINT ck_processing_run_started
  CHECK (status <> 'IN_PROGRESS' OR started_at IS NOT NULL);

CREATE OR REPLACE FUNCTION guard_processing_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Processing runs are retained'; END IF;
 IF ROW(NEW.id, NEW.code, NEW.organization_id, NEW.chain_id, NEW.site_id, NEW.process_type, NEW.base_unit,
        NEW.created_by, NEW.created_at, NEW.product_id, NEW.binding_digest)
   IS DISTINCT FROM ROW(OLD.id, OLD.code, OLD.organization_id, OLD.chain_id, OLD.site_id, OLD.process_type, OLD.base_unit,
        OLD.created_by, OLD.created_at, OLD.product_id, OLD.binding_digest)
   OR NEW.version <> OLD.version + 1
   OR NOT (
     (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','IN_PROGRESS','CANCELLED'))
     -- Runs planned before the lifecycle (no main product) complete directly.
     OR (OLD.status = 'DRAFT' AND NEW.status = 'COMPLETED' AND OLD.product_id IS NULL)
     OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('IN_PROGRESS','COMPLETED','CANCELLED')))
 THEN RAISE EXCEPTION 'Invalid processing run transition'; END IF;
 RETURN NEW;
END $$;

-- Inputs join while planning or running; outputs, losses and lot links only
-- while running (or a legacy draft completing).
CREATE OR REPLACE FUNCTION guard_processing_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_status varchar(20); run_product uuid;
BEGIN
 SELECT status, product_id INTO run_status, run_product FROM processing_run
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
 IF TG_OP = 'INSERT' THEN
   IF TG_TABLE_NAME IN ('processing_input','processing_external_input') THEN
     IF run_status NOT IN ('DRAFT','IN_PROGRESS') THEN RAISE EXCEPTION 'Inputs are added only to open runs'; END IF;
   ELSIF run_product IS NULL THEN
     IF run_status <> 'DRAFT' THEN RAISE EXCEPTION 'Lines are added only to draft runs'; END IF;
   ELSIF run_status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Outputs are recorded only while the run is in progress';
   END IF;
   RETURN NEW;
 END IF;
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Processing lines are retained'; END IF;
 IF TG_TABLE_NAME = 'processing_output' AND OLD.lot_id IS NULL AND NEW.lot_id IS NOT NULL
   AND ROW(NEW.run_id, NEW.product_id, NEW.kind, NEW.quantity, NEW.unit, NEW.base_quantity)
     IS NOT DISTINCT FROM ROW(OLD.run_id, OLD.product_id, OLD.kind, OLD.quantity, OLD.unit, OLD.base_quantity)
   AND run_status IN ('DRAFT','IN_PROGRESS')
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Processing lines are immutable';
END $$;

CREATE TABLE processing_external_input (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES processing_run(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL REFERENCES material_receipt(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit varchar(30) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (run_id, receipt_id)
);
CREATE INDEX ix_processing_external_input_receipt ON processing_external_input(receipt_id);
CREATE TRIGGER trg_processing_external_input_guard BEFORE INSERT OR UPDATE OR DELETE ON processing_external_input
  FOR EACH ROW EXECUTE FUNCTION guard_processing_line();

-- Lot inputs may now be added later; keep when each line joined.
ALTER TABLE processing_input ADD COLUMN created_at timestamptz(6) NOT NULL DEFAULT now();

CREATE TABLE processing_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES processing_run(id) ON DELETE RESTRICT,
  step varchar(30) NOT NULL
    CHECK (step IN ('RECEIVING','SORTING','WASHING','PRELIMINARY','DRYING','ROASTING','MILLING','FERMENTING','COOKING','FREEZING','PACKING','QUALITY_CHECK','CORRECTION','OTHER')),
  occurred_at timestamptz(6) NOT NULL,
  note varchar(2000) NOT NULL,
  corrects_id uuid REFERENCES processing_log(id) ON DELETE RESTRICT,
  recorded_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CHECK ((step = 'CORRECTION') = (corrects_id IS NOT NULL))
);
CREATE INDEX ix_processing_log_run ON processing_log(run_id, occurred_at);

CREATE FUNCTION guard_processing_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Processing log entries are append-only'; END IF;
 IF NOT EXISTS (SELECT 1 FROM processing_run WHERE id = NEW.run_id AND status = 'IN_PROGRESS') THEN
   RAISE EXCEPTION 'Processing log is open only while the run is in progress';
 END IF;
 IF NEW.corrects_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM processing_log WHERE id = NEW.corrects_id AND run_id = NEW.run_id) THEN
   RAISE EXCEPTION 'A correction must refer to an entry of the same run';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_processing_log_guard BEFORE INSERT OR UPDATE OR DELETE ON processing_log
  FOR EACH ROW EXECUTE FUNCTION guard_processing_log();

-- Processed lots are created while the run completes (in progress, or a
-- legacy draft).
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
        IF NOT FOUND OR v_status NOT IN ('DRAFT','IN_PROGRESS') THEN
            RAISE EXCEPTION 'Processed lots are created only while completing an open processing run';
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

-- Mass balance counts external material too; a lifecycle run has exactly one
-- main product.
CREATE OR REPLACE FUNCTION assert_processing_run_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inputs numeric; outputs numeric; losses numeric; tolerance numeric;
BEGIN
 IF NEW.status <> 'COMPLETED' THEN RETURN NULL; END IF;
 SELECT COALESCE(SUM(quantity),0) INTO inputs FROM (
   SELECT quantity FROM processing_input WHERE run_id = NEW.id
   UNION ALL SELECT quantity FROM processing_external_input WHERE run_id = NEW.id) i;
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
 IF NEW.product_id IS NOT NULL AND (SELECT count(*) FROM processing_output
     WHERE run_id = NEW.id AND kind = 'PRODUCT' AND product_id = NEW.product_id) <> 1
    OR NEW.product_id IS NOT NULL AND EXISTS (SELECT 1 FROM processing_output
     WHERE run_id = NEW.id AND kind = 'PRODUCT' AND product_id <> NEW.product_id) THEN
   RAISE EXCEPTION 'A run yields exactly one main product line';
 END IF;
 IF NEW.input_total <> inputs OR NEW.output_total <> outputs OR NEW.loss_total <> losses THEN
   RAISE EXCEPTION 'Processing run totals do not match its lines';
 END IF;
 RETURN NULL;
END $$;

-- Evidence on receipts (invoices, test reports) and log entries (photos).
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_entity_type_check;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_entity_type_check
  CHECK (entity_type IN ('PRODUCT','FARM','SITE','CYCLE','CYCLE_DRAFT','LOT','TRANSFER','MATERIAL','PROFILE',
    'EXTERNAL_PARTNER','MEMBER','CHAIN','SITE_TRANSFER','QUARANTINE','MATERIAL_RECEIPT','PROCESSING_LOG'));
ALTER TABLE trace_evidence DROP CONSTRAINT trace_evidence_kind_chk;
ALTER TABLE trace_evidence ADD CONSTRAINT trace_evidence_kind_chk CHECK (kind IN (
  'OTHER','PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE',
  'PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE',
  'SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','LOT_DOCUMENT','SITE_IMAGE',
  'BUSINESS_LICENSE','TRANSFER_IMAGE','HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO',
  'MEMBER_AVATAR','MEMBER_DOCUMENT','CHAIN_IMAGE','QUARANTINE_IMAGE',
  'PARTNERSHIP_EVIDENCE','RECEIPT_DOCUMENT','PROCESSING_IMAGE'));
