-- Public directory snapshots are distinct from immutable submitted legal profiles.
CREATE TABLE public_directory_publication (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  presentation jsonb NOT NULL CHECK (jsonb_typeof(presentation) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_directory_publication_latest ON public_directory_publication (organization_id, created_at DESC, id DESC);
