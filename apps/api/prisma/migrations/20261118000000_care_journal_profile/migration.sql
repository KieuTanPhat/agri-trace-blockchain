ALTER TABLE care_record
  ADD COLUMN name varchar(255),
  ADD COLUMN journal_code varchar(40);
CREATE UNIQUE INDEX care_record_journal_code_key ON care_record(journal_code);
