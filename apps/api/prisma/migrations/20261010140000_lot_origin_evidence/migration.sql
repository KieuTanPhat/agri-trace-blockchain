-- Preserve existing rows. New updates cannot silently change the QR label or
-- expiry/grade; these fields have no correction command in the approved core.
CREATE OR REPLACE FUNCTION public.fn_lock_lot_origin_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lot_id IS DISTINCT FROM OLD.lot_id OR NEW.harvest_id IS DISTINCT FROM OLD.harvest_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.farm_org_id IS DISTINCT FROM OLD.farm_org_id
    OR NEW.initial_quantity IS DISTINCT FROM OLD.initial_quantity OR NEW.unit IS DISTINCT FROM OLD.unit
    OR NEW.lot_code IS DISTINCT FROM OLD.lot_code OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date
    OR NEW.grade IS DISTINCT FROM OLD.grade OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Lot origin, label and expiry fields are immutable after creation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_harvest_event_immutable BEFORE UPDATE OR DELETE ON harvest_event
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_care_record_immutable BEFORE UPDATE OR DELETE ON care_record
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();
CREATE TRIGGER trg_trace_qr_immutable BEFORE UPDATE OR DELETE ON trace_qr
  FOR EACH ROW EXECUTE FUNCTION protect_command_commit();

CREATE OR REPLACE FUNCTION public.fn_lock_shipment_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shipment_id IS DISTINCT FROM OLD.shipment_id OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
    OR NEW.transporter_org_id IS DISTINCT FROM OLD.transporter_org_id OR NEW.retailer_org_id IS DISTINCT FROM OLD.retailer_org_id
    OR NEW.shipped_quantity IS DISTINCT FROM OLD.shipped_quantity OR NEW.unit IS DISTINCT FROM OLD.unit
    OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.destination IS DISTINCT FROM OLD.destination THEN
    RAISE EXCEPTION 'Shipment assignment, route and shipped quantity are immutable in core';
  END IF;
  RETURN NEW;
END;
$$;
