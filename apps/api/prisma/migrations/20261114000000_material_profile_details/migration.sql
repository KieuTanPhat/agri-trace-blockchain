ALTER TABLE production_material
  ADD COLUMN seed_type varchar(100),
  ADD COLUMN price numeric(14,2),
  ADD COLUMN origin varchar(255),
  ADD COLUMN manufacturer varchar(255),
  ADD COLUMN description varchar(2000),
  ADD COLUMN evidence_complete boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT production_material_price_chk CHECK (price IS NULL OR price >= 0);
