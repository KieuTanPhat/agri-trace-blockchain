-- Chains are no longer crop-only, and every new chain records its supply
-- model: the ordered stages and the organizations taking part in each.
-- Existing chains keep CROP and an empty model (NULL).
ALTER TABLE supply_chain DROP CONSTRAINT supply_chain_type_chk;
ALTER TABLE supply_chain ADD CONSTRAINT supply_chain_type_chk
  CHECK (chain_type IN ('CROP','LIVESTOCK','AQUACULTURE','PROCESSED_FOOD'));
ALTER TABLE supply_chain ADD COLUMN supply_model jsonb
  CHECK (supply_model IS NULL OR jsonb_typeof(supply_model) = 'object');
