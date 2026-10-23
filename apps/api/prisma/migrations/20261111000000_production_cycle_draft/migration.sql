ALTER TABLE production_cycle
  ADD COLUMN name varchar(255),
  ADD COLUMN cultivated_area numeric(12,2),
  ADD CONSTRAINT production_cycle_cultivated_area_chk CHECK (cultivated_area IS NULL OR cultivated_area > 0);

CREATE TABLE production_cycle_draft (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  farm_id uuid NOT NULL REFERENCES farm(farm_id) ON DELETE RESTRICT,
  plot_id uuid NOT NULL REFERENCES plot(plot_id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
  name varchar(255) NOT NULL,
  cycle_code varchar(100) NOT NULL,
  start_date date NOT NULL,
  planned_harvest date NOT NULL,
  cultivated_area numeric(12,2) NOT NULL,
  max_harvest_quantity numeric(14,3),
  harvest_unit varchar(30) NOT NULL,
  note text,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT production_cycle_draft_dates_chk CHECK (planned_harvest >= start_date),
  CONSTRAINT production_cycle_draft_area_chk CHECK (cultivated_area > 0),
  CONSTRAINT production_cycle_draft_quantity_chk CHECK (max_harvest_quantity IS NULL OR max_harvest_quantity > 0),
  CONSTRAINT production_cycle_draft_version_chk CHECK (version >= 0),
  CONSTRAINT production_cycle_draft_farm_code_key UNIQUE (farm_id, cycle_code)
);
CREATE INDEX production_cycle_draft_organization_created_idx
  ON production_cycle_draft (organization_id, created_at);
