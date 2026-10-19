ALTER TABLE harvest_event
  ADD COLUMN representative varchar(255),
  ADD COLUMN harvest_method varchar(100),
  ADD COLUMN note varchar(2000);

ALTER TABLE lot
  ADD COLUMN lot_name varchar(255),
  ADD COLUMN package_count integer,
  ADD COLUMN packaging varchar(255),
  ADD COLUMN packed_at date,
  ADD COLUMN initial_storage_site_id uuid,
  ADD CONSTRAINT lot_package_count_chk CHECK (package_count IS NULL OR package_count > 0);
