-- AgriTrace records provenance, not commercial terms: list prices belong to the
-- seller's own POS/ERP and contract prices to invoices. Drop the indicative
-- product price and the material unit price (and their checks).

ALTER TABLE product DROP COLUMN price;
ALTER TABLE production_material DROP COLUMN price;
