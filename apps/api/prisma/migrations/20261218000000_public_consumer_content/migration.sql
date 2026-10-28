-- Additive only: no changes to accounts, business rows, journal/outbox or old migrations.
CREATE TABLE consumer_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(255) NOT NULL CHECK (length(btrim(title)) > 0),
  summary varchar(1000) NOT NULL CHECK (length(btrim(summary)) > 0),
  body varchar(50000) NOT NULL CHECK (length(btrim(body)) > 0),
  cover_url varchar(2048),
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ck_consumer_news_publication CHECK (NOT is_published OR published_at IS NOT NULL)
);
CREATE INDEX ix_consumer_news_public ON consumer_news (is_published, published_at, id);
CREATE TABLE consumer_announcement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(255) NOT NULL CHECK (length(btrim(title)) > 0),
  body varchar(5000) NOT NULL CHECK (length(btrim(body)) > 0),
  severity varchar(16) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  is_active boolean NOT NULL DEFAULT false,
  starts_at timestamptz(6) NOT NULL,
  ends_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ck_consumer_announcement_window CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX ix_consumer_announcement_public ON consumer_announcement (is_active, starts_at, id);
