-- Goods received from a supplier outside AgriTrace. A retailer or distributor
-- records them from the supplier's documents (photo required) into its own
-- lot; the supplier's lot code, when printed on the documents, links back to
-- a lot that left AgriTrace through an external dispatch. Additive only.

ALTER TABLE product ADD COLUMN external_goods boolean NOT NULL DEFAULT false;
ALTER TABLE product ADD CONSTRAINT product_single_sourcing CHECK (NOT (private_label AND external_goods));

CREATE OR REPLACE FUNCTION guard_product_private_label() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.private_label IS DISTINCT FROM OLD.private_label OR NEW.external_goods IS DISTINCT FROM OLD.external_goods
 THEN RAISE EXCEPTION 'Product sourcing flags are fixed'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER product_private_label_fixed ON product;
CREATE TRIGGER product_sourcing_fixed BEFORE UPDATE OF private_label, external_goods ON product
  FOR EACH ROW EXECUTE FUNCTION guard_product_private_label();

ALTER TABLE material_receipt ADD COLUMN supplier_lot_code varchar(60);
ALTER TABLE material_receipt ADD COLUMN matched_lot_id uuid REFERENCES lot(lot_id);

-- The supplier lot code and its match are recorded once, with the receipt.
CREATE FUNCTION guard_receipt_supplier_lot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.supplier_lot_code IS DISTINCT FROM OLD.supplier_lot_code OR NEW.matched_lot_id IS DISTINCT FROM OLD.matched_lot_id
 THEN RAISE EXCEPTION 'Supplier lot code and its match are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER material_receipt_supplier_lot BEFORE UPDATE OF supplier_lot_code, matched_lot_id ON material_receipt
  FOR EACH ROW EXECUTE FUNCTION guard_receipt_supplier_lot();
