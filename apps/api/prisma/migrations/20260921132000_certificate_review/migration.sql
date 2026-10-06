ALTER TABLE certificate
  ADD COLUMN status varchar(30) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN reviewed_by uuid,
  ADD COLUMN reviewed_at timestamptz(6),
  ADD COLUMN review_note text;

-- Existing certificates were already treated as issued, so preserve their
-- visibility while ensuring every newly submitted certificate needs review.
ALTER TABLE certificate
  ALTER COLUMN status SET DEFAULT 'PENDING';

ALTER TABLE certificate
  ADD CONSTRAINT ck_certificate_status
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));

CREATE INDEX ix_certificate_status ON certificate (status);
