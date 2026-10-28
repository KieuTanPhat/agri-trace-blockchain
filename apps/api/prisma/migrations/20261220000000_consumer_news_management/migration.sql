ALTER TABLE consumer_news
  ADD COLUMN cover_content bytea,
  ADD COLUMN cover_mime_type varchar(40),
  ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD COLUMN archived_at timestamptz;
ALTER TABLE consumer_news ADD CONSTRAINT ck_news_cover CHECK (
  (cover_content IS NULL AND cover_mime_type IS NULL) OR
  (cover_content IS NOT NULL AND cover_mime_type IN ('image/png','image/jpeg','image/webp') AND octet_length(cover_content) BETWEEN 1 AND 393216));
ALTER TABLE consumer_news ADD CONSTRAINT ck_news_version CHECK (version >= 0);
ALTER TABLE consumer_news ADD CONSTRAINT ck_news_archived CHECK (archived_at IS NULL OR NOT is_published);
