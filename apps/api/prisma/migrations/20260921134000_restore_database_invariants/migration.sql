-- Derived lot fields must match their harvest at the write boundary. Rejecting
-- inconsistent input is safer than silently normalizing a malformed command.
CREATE OR REPLACE FUNCTION public.fn_set_lot_derived_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_id UUID;
    v_farm_org_id UUID;
    v_quantity NUMERIC(14,3);
    v_unit VARCHAR(30);
BEGIN
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

-- A reading cannot claim a cycle different from the cycle to which its device
-- is bound. The service validates this too; the trigger protects other writers.
CREATE OR REPLACE FUNCTION public.fn_validate_sensor_reading_device_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_cycle_id UUID;
BEGIN
    SELECT cycle_id
      INTO v_cycle_id
      FROM public.iot_device
     WHERE device_id = NEW.device_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'IoT device % does not exist', NEW.device_id;
    END IF;

    IF v_cycle_id IS NULL OR v_cycle_id IS DISTINCT FROM NEW.cycle_id THEN
        RAISE EXCEPTION 'IoT device % is not bound to production cycle %',
            NEW.device_id,
            NEW.cycle_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_sensor_reading_device_cycle
BEFORE INSERT OR UPDATE OF device_id, cycle_id ON public.sensor_reading
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_sensor_reading_device_cycle();
