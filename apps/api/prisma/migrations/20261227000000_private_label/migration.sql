-- Private label: a retailer or distributor brands goods another business made.
-- The product names the source products it may be packed from; packing runs
-- reuse processing lineage, so each branded lot points to its source lot.
-- Additive only.

ALTER TABLE product ADD COLUMN private_label boolean NOT NULL DEFAULT false;

CREATE TABLE product_label_source (
  product_id uuid NOT NULL REFERENCES product(product_id),
  source_product_id uuid NOT NULL REFERENCES product(product_id),
  created_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, source_product_id),
  CHECK (product_id <> source_product_id)
);
CREATE INDEX product_label_source_source ON product_label_source(source_product_id);

-- A source is a product of another business that is not itself a private
-- label, attached only to a private-label product. Sources are append-only.
CREATE FUNCTION guard_product_label_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE brand product%ROWTYPE; source product%ROWTYPE;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Private-label sources are append-only'; END IF;
 SELECT * INTO brand FROM product WHERE product_id = NEW.product_id;
 SELECT * INTO source FROM product WHERE product_id = NEW.source_product_id;
 IF NOT brand.private_label OR source.private_label
   OR source.organization_id IS NULL OR source.organization_id = brand.organization_id
 THEN RAISE EXCEPTION 'A private label sources products of another business'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER product_label_source_guard BEFORE INSERT OR UPDATE OR DELETE ON product_label_source
  FOR EACH ROW EXECUTE FUNCTION guard_product_label_source();

-- The private-label flag is fixed once set at creation.
CREATE FUNCTION guard_product_private_label() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.private_label IS DISTINCT FROM OLD.private_label THEN RAISE EXCEPTION 'Private-label flag is fixed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER product_private_label_fixed BEFORE UPDATE OF private_label ON product
  FOR EACH ROW EXECUTE FUNCTION guard_product_private_label();
