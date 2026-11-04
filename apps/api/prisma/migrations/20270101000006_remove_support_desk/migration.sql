-- The platform support desk (enterprise tickets) is retired. Its tickets and
-- messages are dropped; platform audit rows that mention SUPPORT_TICKET stay.
DROP TABLE support_message;
DROP TABLE support_ticket;
DROP SEQUENCE IF EXISTS support_ticket_seq;

DELETE FROM reference_item WHERE category = 'TICKET_CATEGORY';
ALTER TABLE reference_item DROP CONSTRAINT reference_item_category_check;
ALTER TABLE reference_item ADD CONSTRAINT reference_item_category_check
  CHECK (category IN ('UNIT','PRODUCT_CATEGORY','CERTIFICATE_TYPE','LOSS_REASON','PROCESSING_TYPE','VEHICLE_TYPE'));

-- The key is kept: it now only times consumer reports in the admin inbox.
UPDATE platform_setting SET description = 'Thời hạn xử lý báo cáo từ người tiêu dùng (giờ) hiển thị trong hộp việc admin'
WHERE key = 'support.reviewSlaHours';
