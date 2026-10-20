-- Display order of a product's photos. The first one is the main photo shown
-- in lists and as the large photo on the detail page. Evidence rows stay
-- immutable; only this ordering changes.
CREATE TABLE product_photo_order (
  product_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  evidence_ids uuid[] NOT NULL CHECK (cardinality(evidence_ids) <= 200),
  actor_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
