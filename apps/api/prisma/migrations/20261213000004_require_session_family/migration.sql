-- Every refresh session belongs to a family. A session created before families
-- existed already started its family at its own id; record that explicitly so
-- the column can be required. The previous API cannot create sessions anymore.
UPDATE refresh_session SET family_id = refresh_session_id WHERE family_id IS NULL;
ALTER TABLE refresh_session ALTER COLUMN family_id SET NOT NULL;
