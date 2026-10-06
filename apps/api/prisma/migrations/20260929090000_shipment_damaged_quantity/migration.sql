ALTER TABLE public.shipment
ADD COLUMN damaged_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0;

ALTER TABLE public.shipment
ADD CONSTRAINT chk_shipment_damaged_quantity
CHECK (damaged_quantity >= 0 AND damaged_quantity <= shipped_quantity);