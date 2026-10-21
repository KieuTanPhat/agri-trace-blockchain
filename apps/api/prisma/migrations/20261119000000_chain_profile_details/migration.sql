ALTER TABLE supply_chain
  ADD COLUMN code varchar(40),
  ADD COLUMN chain_type varchar(30) NOT NULL DEFAULT 'CROP',
  ADD COLUMN description varchar(2000),
  ADD COLUMN planned_start_date date,
  ADD COLUMN note varchar(2000),
  ADD CONSTRAINT supply_chain_type_chk CHECK (chain_type = 'CROP');
CREATE UNIQUE INDEX supply_chain_code_key ON supply_chain(code);

ALTER TABLE chain_business_profile
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspended_by uuid,
  ADD COLUMN suspension_reason varchar(1000);
