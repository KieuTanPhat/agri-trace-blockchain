-- Unit conversion of a processed product. A finished product recorded in a
-- unit other than the run's base unit counts toward the mass balance only
-- through a factor the enterprise declared beforehand; the client no longer
-- decides how much base quantity an output stands for.
CREATE TABLE product_unit_conversion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  unit varchar(30) NOT NULL,
  base_unit varchar(30) NOT NULL,
  factor numeric(14, 6) NOT NULL,
  note varchar(500),
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  revoked_at timestamptz(6),
  revoke_reason varchar(500),
  CONSTRAINT ck_unit_conversion_factor CHECK (factor > 0),
  CONSTRAINT ck_unit_conversion_units CHECK (
    length(btrim(unit)) > 0 AND length(btrim(base_unit)) > 0 AND lower(unit) <> lower(base_unit)
  ),
  CONSTRAINT ck_unit_conversion_revoked CHECK (
    (revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)
  )
);
CREATE UNIQUE INDEX ux_unit_conversion_active
  ON product_unit_conversion (product_id, lower(unit), lower(base_unit)) WHERE revoked_at IS NULL;
CREATE INDEX ix_unit_conversion_product ON product_unit_conversion (product_id);

-- Conversions are never edited or deleted; they are only revoked once, so a
-- completed run can always be explained by the factor it used.
CREATE FUNCTION guard_product_unit_conversion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Unit conversions are retained'; END IF;
 IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
   AND ROW(NEW.id, NEW.product_id, NEW.unit, NEW.base_unit, NEW.factor, NEW.note, NEW.created_by, NEW.created_at)
     IS NOT DISTINCT FROM ROW(OLD.id, OLD.product_id, OLD.unit, OLD.base_unit, OLD.factor, OLD.note, OLD.created_by, OLD.created_at)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Unit conversions are immutable';
END $$;
CREATE TRIGGER trg_product_unit_conversion_guard BEFORE UPDATE OR DELETE ON product_unit_conversion
  FOR EACH ROW EXECUTE FUNCTION guard_product_unit_conversion();

-- Output base quantity: equal to the quantity in the base unit, otherwise the
-- quantity times the product's active factor (rounded to the stored scale).
CREATE FUNCTION assert_processing_output_base() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_unit varchar(30); f numeric(14, 6);
BEGIN
 SELECT base_unit INTO run_unit FROM processing_run WHERE id = NEW.run_id;
 IF lower(NEW.unit) = lower(run_unit) THEN
   IF NEW.base_quantity <> NEW.quantity THEN
     RAISE EXCEPTION 'Output in the base unit must have base_quantity = quantity';
   END IF;
   RETURN NEW;
 END IF;
 SELECT factor INTO f FROM product_unit_conversion
  WHERE product_id = NEW.product_id AND lower(unit) = lower(NEW.unit)
    AND lower(base_unit) = lower(run_unit) AND revoked_at IS NULL;
 IF f IS NULL THEN
   RAISE EXCEPTION 'No active unit conversion for this product from % to %', NEW.unit, run_unit;
 END IF;
 IF NEW.base_quantity <> round(NEW.quantity * f, 3) THEN
   RAISE EXCEPTION 'Output base_quantity must equal quantity times the declared factor';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_processing_output_base BEFORE INSERT ON processing_output
  FOR EACH ROW EXECUTE FUNCTION assert_processing_output_base();
