-- Append-only label print history. A print count never proves goods quantity.
CREATE TABLE trace_label_print (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organization(organization_id),
 lot_id uuid NOT NULL REFERENCES lot(lot_id),
 actor_id uuid NOT NULL REFERENCES app_user(user_id),
 template varchar(20) NOT NULL CHECK(template IN ('COMPACT','STANDARD')),
 copies integer NOT NULL CHECK(copies BETWEEN 1 AND 500),
 reprint boolean NOT NULL,
 reason varchar(1000),
 created_at timestamptz(6) NOT NULL DEFAULT now(),
 CHECK(NOT reprint OR length(btrim(reason))>=10)
);
CREATE INDEX trace_label_print_lot ON trace_label_print(organization_id,lot_id,created_at);
CREATE FUNCTION guard_trace_label_print() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Label print history is append-only';
END $$;
CREATE TRIGGER trace_label_print_guard BEFORE UPDATE OR DELETE ON trace_label_print FOR EACH ROW EXECUTE FUNCTION guard_trace_label_print();
