-- A foreign key can prove that the organization exists, but not that it is
-- allowed to own a farm. Keep this cross-table invariant in PostgreSQL so
-- imports and future code paths cannot bypass it.
CREATE OR REPLACE FUNCTION public.fn_validate_farm_organization_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_organization_type public.organization_type;
BEGIN
  SELECT type
    INTO v_organization_type
    FROM public.organization
   WHERE organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization % does not exist', NEW.organization_id;
  END IF;

  IF v_organization_type <> 'FARM' THEN
    RAISE EXCEPTION 'Farm organization % must have type FARM', NEW.organization_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_farm_organization_type
BEFORE INSERT OR UPDATE OF organization_id ON public.farm
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_farm_organization_type();
