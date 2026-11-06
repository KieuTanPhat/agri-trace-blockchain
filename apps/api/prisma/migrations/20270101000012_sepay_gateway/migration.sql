-- Preserve bank webhook IDs; namespace Gateway receipts to avoid collisions.
ALTER TABLE sepay_webhook_receipt
  DROP CONSTRAINT sepay_webhook_receipt_transaction_id_check,
  ALTER COLUMN transaction_id TYPE varchar(128);
ALTER TABLE sepay_webhook_receipt ADD CONSTRAINT sepay_webhook_receipt_transaction_id_check
  CHECK (transaction_id ~ '^[0-9]{1,20}$' OR transaction_id ~ '^PG:(VOID:)?[A-Za-z0-9_-]{1,100}$');
