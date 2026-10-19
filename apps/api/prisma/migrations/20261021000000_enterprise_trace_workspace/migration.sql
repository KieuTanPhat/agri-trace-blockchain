-- Additive enterprise support. Historical lots, hashes and shipments are untouched.
ALTER TYPE organization_type ADD VALUE 'DISTRIBUTOR';
ALTER TYPE "ScopedRole" ADD VALUE 'DISTRIBUTOR';
ALTER TABLE app_user ADD COLUMN enterprise_tier integer CHECK (enterprise_tier IN (1,2,3)),
 ADD COLUMN supervisor_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
 ADD COLUMN enterprise_revision integer NOT NULL DEFAULT 0 CHECK (enterprise_revision >= 0);
ALTER TABLE product ADD COLUMN organization_id uuid REFERENCES organization(organization_id) ON DELETE RESTRICT,
 ADD COLUMN sku varchar(100), ADD COLUMN gtin varchar(14), ADD COLUMN version integer NOT NULL DEFAULT 0;

CREATE TABLE enterprise_profile (
 organization_id uuid PRIMARY KEY REFERENCES organization(organization_id), legal_form varchar(40) NOT NULL,
 address varchar(500) NOT NULL, province varchar(100) NOT NULL, phone varchar(30) NOT NULL,
 contact_email varchar(255) NOT NULL, representative varchar(255) NOT NULL, activities text[] NOT NULL,
 website varchar(255), description varchar(2000), declaration_accepted_at timestamptz(6) NOT NULL,
 version integer NOT NULL DEFAULT 0,
 CHECK(legal_form IN ('ENTERPRISE','COOPERATIVE','HOUSEHOLD_BUSINESS')),
 CHECK(cardinality(activities) BETWEEN 1 AND 4 AND activities <@ ARRAY['FARM','TRANSPORTER','DISTRIBUTOR','RETAILER']::text[])
);
CREATE TABLE enterprise_role (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 name varchar(100) NOT NULL, permissions text[] NOT NULL, version integer NOT NULL DEFAULT 0,
 UNIQUE(id,organization_id), UNIQUE(organization_id,name)
);
CREATE TABLE enterprise_member_role (
 user_id uuid NOT NULL, organization_id uuid NOT NULL, role_id uuid NOT NULL,
 chain_ids uuid[] NOT NULL, site_ids uuid[] NOT NULL,
 PRIMARY KEY(user_id,role_id), FOREIGN KEY(user_id,organization_id) REFERENCES app_user(user_id,organization_id),
 FOREIGN KEY(role_id,organization_id) REFERENCES enterprise_role(id,organization_id)
);
CREATE TABLE enterprise_partner (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inviter_id uuid NOT NULL REFERENCES organization(organization_id),
 invitee_id uuid NOT NULL REFERENCES organization(organization_id), status varchar(20) NOT NULL DEFAULT 'INVITED',
 version integer NOT NULL DEFAULT 0, note varchar(500), created_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(inviter_id,invitee_id), CHECK(inviter_id<>invitee_id), CHECK(status IN ('INVITED','ACTIVE','REJECTED','REVOKED'))
);
CREATE UNIQUE INDEX enterprise_partner_unordered_pair ON enterprise_partner(LEAST(inviter_id,invitee_id),GREATEST(inviter_id,invitee_id));
CREATE TABLE enterprise_site (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 name varchar(255) NOT NULL, kind varchar(30) NOT NULL, address varchar(500) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 0,
 UNIQUE(id,organization_id), CHECK(kind IN ('PRODUCTION','PACKING','WAREHOUSE','DISTRIBUTION','RETAIL')), CHECK(status IN ('ACTIVE','INACTIVE'))
);
CREATE TABLE enterprise_vehicle (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 registration varchar(40) NOT NULL, kind varchar(100) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 0,
 UNIQUE(organization_id,registration), CHECK(status IN ('ACTIVE','INACTIVE'))
);
CREATE TABLE lot_holding (
 lot_id uuid NOT NULL REFERENCES lot(lot_id), organization_id uuid NOT NULL REFERENCES organization(organization_id),
 quantity numeric(14,3) NOT NULL, reserved numeric(14,3) NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 0,
 PRIMARY KEY(lot_id,organization_id), CHECK(quantity>=0 AND reserved>=0 AND reserved<=quantity)
);
CREATE TABLE distribution_transfer (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chain_id uuid NOT NULL REFERENCES supply_chain(chain_id),
 sender_id uuid NOT NULL REFERENCES organization(organization_id), carrier_id uuid NOT NULL REFERENCES organization(organization_id),
 receiver_id uuid NOT NULL REFERENCES organization(organization_id), origin varchar(500) NOT NULL, destination varchar(500) NOT NULL,
 vehicle_id uuid REFERENCES enterprise_vehicle(id), status varchar(30) NOT NULL DEFAULT 'PROPOSED',
 version integer NOT NULL DEFAULT 0, created_at timestamptz(6) NOT NULL DEFAULT now(),
 CHECK(sender_id<>receiver_id AND sender_id<>carrier_id AND carrier_id<>receiver_id),
 CHECK(status IN ('PROPOSED','READY','IN_TRANSIT','DELIVERED','CANCELLED'))
);
CREATE INDEX distribution_sender_status ON distribution_transfer(sender_id,status);
CREATE INDEX distribution_receiver_status ON distribution_transfer(receiver_id,status);
CREATE INDEX distribution_carrier_status ON distribution_transfer(carrier_id,status);
CREATE TABLE distribution_line (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL REFERENCES distribution_transfer(id),
 lot_id uuid NOT NULL REFERENCES lot(lot_id), quantity numeric(14,3) NOT NULL CHECK(quantity>0), unit varchar(30) NOT NULL,
 UNIQUE(transfer_id,lot_id)
);
CREATE INDEX distribution_line_lot ON distribution_line(lot_id);
CREATE TABLE distribution_key (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organization(organization_id),
 public_key varchar(59) NOT NULL, label varchar(100) NOT NULL, status varchar(20) NOT NULL DEFAULT 'ACTIVE',
 created_at timestamptz(6) NOT NULL DEFAULT now(), UNIQUE(id,organization_id), CHECK(status IN ('ACTIVE','REVOKED'))
);
CREATE TABLE distribution_attestation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL REFERENCES distribution_transfer(id),
 organization_id uuid NOT NULL, user_id uuid NOT NULL, phase varchar(20) NOT NULL,
 key_ref uuid NOT NULL, digest varchar(64) NOT NULL, signature varchar(86) NOT NULL,
 authority jsonb NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,organization_id) REFERENCES app_user(user_id,organization_id),
 FOREIGN KEY(key_ref,organization_id) REFERENCES distribution_key(id,organization_id),
 UNIQUE(transfer_id,organization_id,phase), CHECK(phase IN ('CONSENT','PICKUP','DELIVERY')),
 CHECK(digest ~ '^[a-f0-9]{64}$'), CHECK(signature ~ '^[A-Za-z0-9_-]{86}$')
);
CREATE FUNCTION guard_distribution_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Distribution history is append-only'; END $$;
CREATE TRIGGER distribution_line_immutable BEFORE UPDATE OR DELETE ON distribution_line FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE TRIGGER distribution_attestation_immutable BEFORE UPDATE OR DELETE ON distribution_attestation FOR EACH ROW EXECUTE FUNCTION guard_distribution_immutable();
CREATE FUNCTION guard_distribution_lot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='shipment' THEN
   PERFORM 1 FROM lot WHERE lot_id=NEW.lot_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM lot_holding WHERE lot_id=NEW.lot_id) THEN RAISE EXCEPTION 'Lot uses distribution allocation'; END IF;
 ELSE
   PERFORM 1 FROM lot WHERE lot_id=NEW.lot_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM shipment WHERE lot_id=NEW.lot_id) THEN RAISE EXCEPTION 'Legacy shipment must be reconciled before distribution'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_excludes_legacy BEFORE INSERT ON lot_holding FOR EACH ROW EXECUTE FUNCTION guard_distribution_lot();
CREATE TRIGGER legacy_excludes_distribution BEFORE INSERT ON shipment FOR EACH ROW EXECUTE FUNCTION guard_distribution_lot();
CREATE FUNCTION guard_distribution_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Distribution history is append-only'; END IF;
 IF ROW(NEW.id,NEW.chain_id,NEW.sender_id,NEW.carrier_id,NEW.receiver_id,NEW.origin,NEW.destination,NEW.vehicle_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.chain_id,OLD.sender_id,OLD.carrier_id,OLD.receiver_id,OLD.origin,OLD.destination,OLD.vehicle_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Transfer snapshot is immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR NOT (
   (OLD.status='PROPOSED' AND NEW.status IN ('PROPOSED','READY','CANCELLED')) OR
   (OLD.status='READY' AND NEW.status IN ('READY','IN_TRANSIT','CANCELLED')) OR
   (OLD.status='IN_TRANSIT' AND NEW.status IN ('IN_TRANSIT','DELIVERED')))
 THEN RAISE EXCEPTION 'Invalid transfer transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_transfer_guard BEFORE UPDATE OR DELETE ON distribution_transfer FOR EACH ROW EXECUTE FUNCTION guard_distribution_transfer();
