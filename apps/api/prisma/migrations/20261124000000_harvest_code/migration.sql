ALTER TABLE harvest_event ADD COLUMN harvest_code varchar(40);
CREATE UNIQUE INDEX harvest_event_harvest_code_key ON harvest_event(harvest_code);
