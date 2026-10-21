CREATE OR REPLACE FUNCTION guard_enterprise_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.permissions <@ ARRAY['profile.read','members.read','members.manage','roles.manage','partners.read','partners.manage','catalog.read','catalog.manage','sites.read','sites.manage','vehicles.read','vehicles.manage','production.read','production.write','distribution.read','distribution.write','distribution.sign','trace.read','qr.manage','reports.read','quantity.adjust']::text[]
 THEN RAISE EXCEPTION 'Unknown enterprise permission'; END IF;
 RETURN NEW;
END $$;
