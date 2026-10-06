CREATE OR REPLACE FUNCTION public.fn_lock_shipment_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.lot_id IS DISTINCT FROM OLD.lot_id
       OR NEW.transporter_org_id IS DISTINCT FROM OLD.transporter_org_id
       OR NEW.retailer_org_id IS DISTINCT FROM OLD.retailer_org_id
       OR NEW.unit IS DISTINCT FROM OLD.unit THEN
        RAISE EXCEPTION
            'Shipment lot/transporter/retailer/unit are immutable after creation';
    END IF;

    IF NEW.shipped_quantity IS DISTINCT FROM OLD.shipped_quantity THEN
        IF OLD.status <> 'CREATED'
           OR NEW.status NOT IN ('CREATED', 'FAILED') THEN
            RAISE EXCEPTION
                'shipped_quantity can only change before transport starts';
        END IF;

        IF NEW.shipped_quantity >= OLD.shipped_quantity THEN
            RAISE EXCEPTION
                'shipped_quantity may only decrease before handover';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER TABLE public.shipment
DROP CONSTRAINT IF EXISTS chk_shipment_quantity_positive;

ALTER TABLE public.shipment
ADD CONSTRAINT chk_shipment_quantity_valid
CHECK (
    (status = 'FAILED' AND shipped_quantity >= 0)
    OR
    (status <> 'FAILED' AND shipped_quantity > 0)
);

ALTER TABLE public.shipment
ADD CONSTRAINT chk_shipment_quantity_balance
CHECK (
    COALESCE(received_quantity, 0)
    + damaged_quantity
    + COALESCE(rejected_quantity, 0)
    <= shipped_quantity
);