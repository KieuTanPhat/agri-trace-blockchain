ALTER TABLE farm
  ADD COLUMN internal_code varchar(40),
  ADD COLUMN kind varchar(100),
  ADD COLUMN region varchar(255),
  ADD COLUMN address varchar(500),
  ADD COLUMN area_m2 numeric(14,2),
  ADD COLUMN expected_output numeric(14,3),
  ADD COLUMN output_unit varchar(30),
  ADD COLUMN representative varchar(255),
  ADD COLUMN phone varchar(30),
  ADD COLUMN email varchar(255),
  ADD COLUMN privacy varchar(10) NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN other_info varchar(2000),
  ADD COLUMN evidence_complete boolean NOT NULL DEFAULT true,
  ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT farm_privacy_chk CHECK (privacy IN ('PRIVATE','PUBLIC')),
  ADD CONSTRAINT farm_area_m2_chk CHECK (area_m2 IS NULL OR area_m2 > 0),
  ADD CONSTRAINT farm_output_chk CHECK (expected_output IS NULL OR expected_output > 0),
  ADD CONSTRAINT farm_version_chk CHECK (version >= 0);
CREATE UNIQUE INDEX farm_internal_code_key ON farm (internal_code);

ALTER TABLE product
  ADD COLUMN category varchar(100),
  ADD COLUMN origin_farm_id uuid REFERENCES farm(farm_id) ON DELETE RESTRICT,
  ADD COLUMN price numeric(14,2),
  ADD COLUMN storage_conditions varchar(2000),
  ADD COLUMN ingredients varchar(2000),
  ADD COLUMN usage_instructions varchar(2000),
  ADD COLUMN evidence_complete boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT product_price_chk CHECK (price IS NULL OR price >= 0);
CREATE INDEX product_origin_farm_idx ON product (origin_farm_id);
