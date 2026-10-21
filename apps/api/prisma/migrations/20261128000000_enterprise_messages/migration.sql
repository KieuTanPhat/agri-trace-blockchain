-- Internal notifications inside one organization: administrators start a
-- thread for selected members (or everyone); participants reply like a chat.
CREATE TABLE enterprise_message_thread (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organization(organization_id),
 subject varchar(200) NOT NULL,
 created_by uuid NOT NULL REFERENCES app_user(user_id),
 created_at timestamptz(6) NOT NULL DEFAULT now(),
 last_message_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX enterprise_message_thread_org ON enterprise_message_thread(organization_id, last_message_at DESC);

CREATE TABLE enterprise_message (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 thread_id uuid NOT NULL REFERENCES enterprise_message_thread(id),
 author_id uuid NOT NULL REFERENCES app_user(user_id),
 body varchar(4000) NOT NULL CHECK (length(btrim(body)) > 0),
 created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX enterprise_message_thread_time ON enterprise_message(thread_id, created_at);

CREATE TABLE enterprise_message_participant (
 thread_id uuid NOT NULL REFERENCES enterprise_message_thread(id),
 user_id uuid NOT NULL REFERENCES app_user(user_id),
 read_at timestamptz(6),
 PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX enterprise_message_participant_user ON enterprise_message_participant(user_id);

-- Sent messages are history: no edits or deletions.
CREATE OR REPLACE FUNCTION guard_enterprise_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Enterprise messages are immutable';
END $$;
CREATE TRIGGER enterprise_message_immutable BEFORE UPDATE OR DELETE ON enterprise_message
  FOR EACH ROW EXECUTE FUNCTION guard_enterprise_message();
