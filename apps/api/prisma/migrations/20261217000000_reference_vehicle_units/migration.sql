-- Forms pick units, product groups, certificate and vehicle types from the
-- platform reference lists instead of free text. Adds the vehicle type list
-- and common farm units; existing items and stored values are unchanged.
ALTER TABLE reference_item DROP CONSTRAINT reference_item_category_check;
ALTER TABLE reference_item ADD CONSTRAINT reference_item_category_check
  CHECK (category IN ('UNIT','PRODUCT_CATEGORY','CERTIFICATE_TYPE','LOSS_REASON','PROCESSING_TYPE','TICKET_CATEGORY','VEHICLE_TYPE'));

INSERT INTO reference_item(category, code, label, sort_order) VALUES
  ('UNIT','G','Gam',5),('UNIT','TA','Tạ',15),('UNIT','BAO','Bao',35),
  ('UNIT','QUA','Quả',80),('UNIT','BO','Bó',90),('UNIT','CAY','Cây',100),
  ('VEHICLE_TYPE','XE_TAI','Xe tải',10),('VEHICLE_TYPE','XE_TAI_LANH','Xe tải lạnh',20),
  ('VEHICLE_TYPE','XE_BAN_TAI','Xe bán tải',30),('VEHICLE_TYPE','CONTAINER','Xe container',40),
  ('VEHICLE_TYPE','XE_MAY','Xe máy',50),('VEHICLE_TYPE','KHAC','Khác',90)
ON CONFLICT (category, code) DO NOTHING;
