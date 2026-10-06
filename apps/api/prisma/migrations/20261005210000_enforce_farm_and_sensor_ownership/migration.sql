CREATE FUNCTION public.fn_validate_farm_organization_type() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  organization_type public.organization_type;
BEGIN
  SELECT type INTO organization_type
  FROM public.organization
  WHERE organization_id = NEW.organization_id;

  IF organization_type IS DISTINCT FROM 'FARM'::public.organization_type THEN
    RAISE EXCEPTION 'Farm organization must have type FARM'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_farm_organization_type
BEFORE INSERT OR UPDATE OF organization_id ON public.farm
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_farm_organization_type();

CREATE FUNCTION public.fn_validate_sensor_reading_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bound_cycle_id UUID;
BEGIN
  SELECT cycle_id INTO bound_cycle_id
  FROM public.iot_device
  WHERE device_id = NEW.device_id;

  IF bound_cycle_id IS DISTINCT FROM NEW.cycle_id THEN
    RAISE EXCEPTION 'SensorReading cycle must match device cycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_sensor_reading_cycle
BEFORE INSERT OR UPDATE OF device_id, cycle_id ON public.sensor_reading
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_sensor_reading_cycle();
