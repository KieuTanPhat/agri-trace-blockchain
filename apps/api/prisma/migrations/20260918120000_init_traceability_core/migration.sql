--
-- PostgreSQL database dump
--

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- transaction_timeout was introduced after PostgreSQL 16. Omitting this
-- pg_dump session setting keeps the baseline portable to the supported image.
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
-- Keep Prisma's migration bookkeeping table resolvable after this pg_dump-
-- derived baseline runs. An empty search_path makes Prisma's subsequent
-- update to _prisma_migrations fail with P1014 on the same connection.
SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_status AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'LOCKED'
);


--
-- Name: blockchain_transaction_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.blockchain_transaction_status AS ENUM (
    'PENDING',
    'COMMITTED',
    'FAILED'
);


--
-- Name: device_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.device_status AS ENUM (
    'ACTIVE',
    'INACTIVE'
);


--
-- Name: idempotency_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.idempotency_status AS ENUM (
    'PROCESSING',
    'COMPLETED',
    'FAILED'
);


--
-- Name: inspection_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inspection_result AS ENUM (
    'PASS',
    'FAIL',
    'CONDITIONAL'
);


--
-- Name: lot_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lot_state AS ENUM (
    'HARVESTED',
    'IN_TRANSPORT',
    'ARRIVED',
    'RETAIL_RECEIVED',
    'FOR_SALE',
    'SOLD',
    'RECALLED',
    'EXPIRED',
    'DAMAGED',
    'REJECTED'
);


--
-- Name: organization_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.organization_status AS ENUM (
    'ACTIVE',
    'INACTIVE'
);


--
-- Name: organization_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.organization_type AS ENUM (
    'FARM',
    'TRANSPORTER',
    'RETAILER',
    'AUDITOR'
);


--
-- Name: production_cycle_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.production_cycle_state AS ENUM (
    'CREATED',
    'PLANTED',
    'GROWING',
    'COMPLETED',
    'CANCELLED'
);


--
-- Name: shipment_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shipment_state AS ENUM (
    'CREATED',
    'IN_TRANSIT',
    'ARRIVED',
    'DELIVERED',
    'REJECTED',
    'FAILED'
);


--
-- Name: fn_lock_lot_origin_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_lock_lot_origin_fields() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.harvest_id IS DISTINCT FROM OLD.harvest_id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.farm_org_id IS DISTINCT FROM OLD.farm_org_id
       OR NEW.initial_quantity IS DISTINCT FROM OLD.initial_quantity
       OR NEW.unit IS DISTINCT FROM OLD.unit THEN
        RAISE EXCEPTION 'Lot origin fields are immutable after creation';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_lock_shipment_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_lock_shipment_assignment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.lot_id IS DISTINCT FROM OLD.lot_id
       OR NEW.transporter_org_id IS DISTINCT FROM OLD.transporter_org_id
       OR NEW.retailer_org_id IS DISTINCT FROM OLD.retailer_org_id
       OR NEW.shipped_quantity IS DISTINCT FROM OLD.shipped_quantity
       OR NEW.unit IS DISTINCT FROM OLD.unit THEN
        RAISE EXCEPTION 'Shipment lot/transporter/retailer/quantity/unit are immutable after creation in core';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_prevent_trace_event_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_prevent_trace_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'TraceEvent is append-only. Insert a correction/superseding event instead.';
END;
$$;


--
-- Name: fn_set_cycle_farm_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_cycle_farm_org() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_org_id UUID;
    v_farm_status organization_status;
BEGIN
    SELECT organization_id, status
      INTO v_org_id, v_farm_status
      FROM farm
     WHERE farm_id = NEW.farm_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Farm % does not exist', NEW.farm_id;
    END IF;

    IF v_farm_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Farm % is not ACTIVE', NEW.farm_id;
    END IF;

    NEW.farm_org_id := v_org_id;
    RETURN NEW;
END;
$$;


--
-- Name: fn_set_lot_derived_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_lot_derived_fields() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_product_id UUID;
    v_farm_org_id UUID;
    v_quantity NUMERIC(14,3);
    v_unit VARCHAR(30);
BEGIN
    SELECT pc.product_id,
           pc.farm_org_id,
           he.quantity,
           he.unit
      INTO v_product_id,
           v_farm_org_id,
           v_quantity,
           v_unit
      FROM harvest_event he
      JOIN production_cycle pc ON pc.cycle_id = he.cycle_id
     WHERE he.harvest_id = NEW.harvest_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'HarvestEvent % does not exist', NEW.harvest_id;
    END IF;

    NEW.product_id := v_product_id;
    NEW.farm_org_id := v_farm_org_id;
    NEW.initial_quantity := v_quantity;
    NEW.available_quantity := v_quantity;
    NEW.unit := v_unit;
    NEW.current_state := 'HARVESTED';

    RETURN NEW;
END;
$$;


--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


--
-- Name: fn_validate_blockchain_proof_hash(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validate_blockchain_proof_hash() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_event_hash VARCHAR(64);
BEGIN
    SELECT data_hash
      INTO v_event_hash
      FROM trace_event
     WHERE event_id = NEW.event_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TraceEvent % does not exist', NEW.event_id;
    END IF;

    IF NEW.data_hash <> v_event_hash THEN
        RAISE EXCEPTION 'BlockchainProof data_hash must match TraceEvent data_hash';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_validate_shipment_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validate_shipment_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_lot_state lot_state;
    v_available NUMERIC(14,3);
    v_lot_unit VARCHAR(30);
    v_transporter_type organization_type;
    v_transporter_status organization_status;
    v_retailer_type organization_type;
    v_retailer_status organization_status;
BEGIN
    SELECT current_state, available_quantity, unit
      INTO v_lot_state, v_available, v_lot_unit
      FROM lot
     WHERE lot_id = NEW.lot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lot % does not exist', NEW.lot_id;
    END IF;

    IF v_lot_state <> 'HARVESTED' THEN
        RAISE EXCEPTION 'Shipment can only be created for HARVESTED Lot. Current state: %', v_lot_state;
    END IF;

    IF NEW.shipped_quantity <> v_available THEN
        RAISE EXCEPTION 'Core does not support split lot: shipped_quantity (%) must equal available_quantity (%)',
            NEW.shipped_quantity, v_available;
    END IF;

    IF NEW.unit <> v_lot_unit THEN
        RAISE EXCEPTION 'Shipment unit (%) must match Lot unit (%)', NEW.unit, v_lot_unit;
    END IF;

    IF NEW.status <> 'CREATED' THEN
        RAISE EXCEPTION 'New Shipment must start at CREATED state';
    END IF;

    SELECT type, status
      INTO v_transporter_type, v_transporter_status
      FROM organization
     WHERE organization_id = NEW.transporter_org_id;

    IF NOT FOUND OR v_transporter_type <> 'TRANSPORTER' OR v_transporter_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'transporter_org_id must reference an ACTIVE TRANSPORTER organization';
    END IF;

    SELECT type, status
      INTO v_retailer_type, v_retailer_status
      FROM organization
     WHERE organization_id = NEW.retailer_org_id;

    IF NOT FOUND OR v_retailer_type <> 'RETAILER' OR v_retailer_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'retailer_org_id must reference an ACTIVE RETAILER organization';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_validate_shipment_telemetry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validate_shipment_telemetry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_shipment_status shipment_state;
    v_binding_shipment UUID;
    v_binding_device UUID;
    v_binding_status VARCHAR(30);
    v_bound_at TIMESTAMPTZ;
    v_unbound_at TIMESTAMPTZ;
BEGIN
    SELECT status
      INTO v_shipment_status
      FROM shipment
     WHERE shipment_id = NEW.shipment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shipment % does not exist', NEW.shipment_id;
    END IF;

    IF v_shipment_status <> 'IN_TRANSIT' THEN
        RAISE EXCEPTION 'Main tracking telemetry is only accepted while Shipment is IN_TRANSIT';
    END IF;

    SELECT shipment_id, device_id, status, bound_at, unbound_at
      INTO v_binding_shipment, v_binding_device, v_binding_status, v_bound_at, v_unbound_at
      FROM shipment_tracking_binding
     WHERE binding_id = NEW.binding_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tracking binding % does not exist', NEW.binding_id;
    END IF;

    IF v_binding_shipment <> NEW.shipment_id OR v_binding_device <> NEW.device_id THEN
        RAISE EXCEPTION 'Telemetry shipment/device does not match tracking binding';
    END IF;

    IF v_binding_status <> 'ACTIVE' OR v_unbound_at IS NOT NULL THEN
        RAISE EXCEPTION 'Tracking binding is not ACTIVE';
    END IF;

    IF NEW.recorded_at < v_bound_at THEN
        RAISE EXCEPTION 'Telemetry recorded_at is before binding bound_at';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_validate_tracking_binding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validate_tracking_binding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_shipment_transporter UUID;
    v_shipment_status shipment_state;
    v_device_org UUID;
    v_device_status device_status;
BEGIN
    SELECT transporter_org_id, status
      INTO v_shipment_transporter, v_shipment_status
      FROM shipment
     WHERE shipment_id = NEW.shipment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shipment % does not exist', NEW.shipment_id;
    END IF;

    IF v_shipment_status NOT IN ('CREATED', 'IN_TRANSIT') THEN
        RAISE EXCEPTION 'Tracking device can only be bound while Shipment is CREATED/IN_TRANSIT';
    END IF;

    IF NEW.transporter_org_id <> v_shipment_transporter THEN
        RAISE EXCEPTION 'Binding transporter_org_id does not match Shipment transporter_org_id';
    END IF;

    SELECT organization_id, status
      INTO v_device_org, v_device_status
      FROM iot_device
     WHERE device_id = NEW.device_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Device % does not exist', NEW.device_id;
    END IF;

    IF v_device_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Tracking device must be ACTIVE';
    END IF;

    IF v_device_org <> v_shipment_transporter THEN
        RAISE EXCEPTION 'Tracking device organization must match Shipment transporter organization';
    END IF;

    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_role (
    role_id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(120) NOT NULL,
    description text
);


--
-- Name: app_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    role_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    full_name character varying(255) NOT NULL,
    account_status public.account_status DEFAULT 'ACTIVE'::public.account_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: blockchain_proof; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blockchain_proof (
    proof_id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    network character varying(100) NOT NULL,
    tx_id character varying(255),
    data_hash character varying(64) NOT NULL,
    recorded_at timestamp with time zone,
    relayer_address character varying(255),
    transaction_status public.blockchain_transaction_status DEFAULT 'PENDING'::public.blockchain_transaction_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_blockchain_committed_fields CHECK (((transaction_status <> 'COMMITTED'::public.blockchain_transaction_status) OR ((tx_id IS NOT NULL) AND (recorded_at IS NOT NULL)))),
    CONSTRAINT chk_blockchain_proof_hash CHECK (((data_hash)::text ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: care_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.care_record (
    care_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id uuid NOT NULL,
    care_type character varying(100) NOT NULL,
    event_time timestamp with time zone NOT NULL,
    material_name character varying(255),
    active_ingredient character varying(255),
    quantity numeric(14,4),
    unit character varying(30),
    method character varying(255),
    application_area character varying(255),
    withdrawal_period integer,
    note text,
    evidence_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_care_quantity CHECK (((quantity IS NULL) OR (quantity > (0)::numeric))),
    CONSTRAINT chk_care_withdrawal_period CHECK (((withdrawal_period IS NULL) OR (withdrawal_period >= 0)))
);


--
-- Name: certificate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificate (
    certificate_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid,
    cycle_id uuid,
    type character varying(120) NOT NULL,
    issuer character varying(255) NOT NULL,
    issue_date date NOT NULL,
    expiry_date date,
    document_ref text NOT NULL,
    document_hash character varying(128) NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_certificate_dates CHECK (((expiry_date IS NULL) OR (expiry_date >= issue_date))),
    CONSTRAINT chk_certificate_single_subject CHECK ((((lot_id IS NOT NULL) AND (cycle_id IS NULL)) OR ((lot_id IS NULL) AND (cycle_id IS NOT NULL))))
);


--
-- Name: farm; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farm (
    farm_id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    location text,
    status public.organization_status DEFAULT 'ACTIVE'::public.organization_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: harvest_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.harvest_event (
    harvest_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id uuid NOT NULL,
    final_sensor_digest_id uuid,
    harvest_time timestamp with time zone NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit character varying(30) NOT NULL,
    quality_note text,
    grade character varying(100),
    harvest_area character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_harvest_quantity_positive CHECK ((quantity > (0)::numeric))
);


--
-- Name: idempotency_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_record (
    idempotency_record_id uuid DEFAULT gen_random_uuid() NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    operation character varying(100) NOT NULL,
    request_type character varying(100) NOT NULL,
    request_hash character varying(64) NOT NULL,
    status public.idempotency_status DEFAULT 'PROCESSING'::public.idempotency_status NOT NULL,
    response_status integer,
    response_body jsonb,
    resource_id character varying(255),
    requester_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT chk_idempotency_expiry CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT chk_idempotency_request_hash CHECK (((request_hash)::text ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: inspection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection (
    inspection_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    inspector_org_id uuid,
    result public.inspection_result NOT NULL,
    note text,
    inspected_at timestamp with time zone NOT NULL,
    evidence_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: iot_device; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iot_device (
    device_id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    cycle_id uuid,
    device_code character varying(120) NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(100) NOT NULL,
    status public.device_status DEFAULT 'ACTIVE'::public.device_status NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lot (
    lot_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_code character varying(120) NOT NULL,
    harvest_id uuid NOT NULL,
    product_id uuid NOT NULL,
    farm_org_id uuid NOT NULL,
    initial_quantity numeric(14,3) NOT NULL,
    available_quantity numeric(14,3) NOT NULL,
    unit character varying(30) NOT NULL,
    grade character varying(100),
    expiry_date date,
    current_state public.lot_state DEFAULT 'HARVESTED'::public.lot_state NOT NULL,
    parent_lot_id uuid,
    lineage_type character varying(100),
    version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_lot_available_quantity CHECK (((available_quantity >= (0)::numeric) AND (available_quantity <= initial_quantity))),
    CONSTRAINT chk_lot_initial_quantity_positive CHECK ((initial_quantity > (0)::numeric)),
    CONSTRAINT chk_lot_not_own_parent CHECK (((parent_lot_id IS NULL) OR (parent_lot_id <> lot_id))),
    CONSTRAINT chk_lot_version CHECK ((version >= 0))
);


--
-- Name: organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization (
    organization_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    type public.organization_type NOT NULL,
    status public.organization_status DEFAULT 'ACTIVE'::public.organization_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: plot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plot (
    plot_id uuid DEFAULT gen_random_uuid() NOT NULL,
    farm_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    area numeric(12,2),
    unit character varying(30),
    location text,
    status public.organization_status DEFAULT 'ACTIVE'::public.organization_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_plot_area_positive CHECK (((area IS NULL) OR (area > (0)::numeric)))
);


--
-- Name: product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product (
    product_id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_name character varying(255) NOT NULL,
    variety character varying(255),
    default_unit character varying(30),
    description text,
    status public.organization_status DEFAULT 'ACTIVE'::public.organization_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: production_cycle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_cycle (
    cycle_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_code character varying(100) NOT NULL,
    product_id uuid NOT NULL,
    farm_id uuid NOT NULL,
    farm_org_id uuid NOT NULL,
    plot_id uuid,
    start_date date,
    planned_harvest date,
    current_state public.production_cycle_state DEFAULT 'CREATED'::public.production_cycle_state NOT NULL,
    note text,
    version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_production_cycle_dates CHECK (((planned_harvest IS NULL) OR (start_date IS NULL) OR (planned_harvest >= start_date))),
    CONSTRAINT chk_production_cycle_version CHECK ((version >= 0))
);


--
-- Name: quantity_movement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quantity_movement (
    movement_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    event_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit character varying(30) NOT NULL,
    before_qty numeric(14,3) NOT NULL,
    delta numeric(14,3) NOT NULL,
    after_qty numeric(14,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_quantity_movement_after CHECK ((after_qty >= (0)::numeric)),
    CONSTRAINT chk_quantity_movement_before CHECK ((before_qty >= (0)::numeric)),
    CONSTRAINT chk_quantity_movement_formula CHECK ((after_qty = (before_qty + delta))),
    CONSTRAINT chk_quantity_movement_quantity CHECK ((quantity > (0)::numeric))
);


--
-- Name: sensor_digest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sensor_digest (
    digest_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    reading_count integer NOT NULL,
    digest_hash character varying(64) NOT NULL,
    schema_version character varying(50) DEFAULT 'sensor-digest-1'::character varying NOT NULL,
    canonicalization_version character varying(50) DEFAULT 'RFC8785-JCS-v1'::character varying NOT NULL,
    is_final boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_sensor_digest_count CHECK ((reading_count >= 0)),
    CONSTRAINT chk_sensor_digest_hash CHECK (((digest_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT chk_sensor_digest_period CHECK ((period_end >= period_start))
);


--
-- Name: sensor_reading; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sensor_reading (
    reading_id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    sensor_type character varying(100) NOT NULL,
    value numeric(16,6) NOT NULL,
    unit character varying(30) NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    ingest_time timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment (
    shipment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    transporter_org_id uuid NOT NULL,
    retailer_org_id uuid NOT NULL,
    origin text NOT NULL,
    destination text NOT NULL,
    shipped_quantity numeric(14,3) NOT NULL,
    unit character varying(30) NOT NULL,
    planned_pickup_time timestamp with time zone,
    expected_arrival_time timestamp with time zone,
    pickup_time timestamp with time zone,
    arrival_time timestamp with time zone,
    received_time timestamp with time zone,
    received_quantity numeric(14,3),
    rejected_quantity numeric(14,3),
    reject_reason text,
    vehicle_ref character varying(255),
    conditions jsonb,
    status public.shipment_state DEFAULT 'CREATED'::public.shipment_state NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_shipment_quantity_positive CHECK ((shipped_quantity > (0)::numeric)),
    CONSTRAINT chk_shipment_receive_time CHECK (((received_time IS NULL) OR (arrival_time IS NULL) OR (received_time >= arrival_time))),
    CONSTRAINT chk_shipment_received_quantity CHECK (((received_quantity IS NULL) OR ((received_quantity > (0)::numeric) AND (received_quantity <= shipped_quantity)))),
    CONSTRAINT chk_shipment_rejected_quantity CHECK (((rejected_quantity IS NULL) OR ((rejected_quantity >= (0)::numeric) AND (rejected_quantity <= shipped_quantity)))),
    CONSTRAINT chk_shipment_time_order CHECK (((arrival_time IS NULL) OR (pickup_time IS NULL) OR (arrival_time >= pickup_time))),
    CONSTRAINT chk_shipment_version CHECK ((version >= 0))
);


--
-- Name: shipment_telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_telemetry (
    telemetry_id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    device_id uuid NOT NULL,
    binding_id uuid NOT NULL,
    device_sequence bigint,
    idempotency_key character varying(150),
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    accuracy numeric(10,3),
    speed numeric(12,3),
    heading numeric(7,3),
    temperature numeric(10,3),
    humidity numeric(10,3),
    battery numeric(6,2),
    recorded_at timestamp with time zone NOT NULL,
    ingest_time timestamp with time zone DEFAULT now() NOT NULL,
    validity_status character varying(30),
    anomaly_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_telemetry_accuracy CHECK (((accuracy IS NULL) OR (accuracy >= (0)::numeric))),
    CONSTRAINT chk_telemetry_battery CHECK (((battery IS NULL) OR ((battery >= (0)::numeric) AND (battery <= (100)::numeric)))),
    CONSTRAINT chk_telemetry_heading CHECK (((heading IS NULL) OR ((heading >= (0)::numeric) AND (heading < (360)::numeric)))),
    CONSTRAINT chk_telemetry_humidity CHECK (((humidity IS NULL) OR ((humidity >= (0)::numeric) AND (humidity <= (100)::numeric)))),
    CONSTRAINT chk_telemetry_latitude CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
    CONSTRAINT chk_telemetry_longitude CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))),
    CONSTRAINT chk_telemetry_speed CHECK (((speed IS NULL) OR (speed >= (0)::numeric)))
);


--
-- Name: shipment_telemetry_digest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_telemetry_digest (
    digest_id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    device_id uuid,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    reading_count integer NOT NULL,
    first_latitude numeric(9,6),
    first_longitude numeric(9,6),
    last_latitude numeric(9,6),
    last_longitude numeric(9,6),
    condition_summary jsonb,
    anomaly_summary jsonb,
    digest_hash character varying(64) NOT NULL,
    previous_digest_hash character varying(64),
    schema_version character varying(50) DEFAULT 'shipment-telemetry-digest-1'::character varying NOT NULL,
    canonicalization_version character varying(50) DEFAULT 'RFC8785-JCS-v1'::character varying NOT NULL,
    is_final boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_tracking_digest_count CHECK ((reading_count >= 0)),
    CONSTRAINT chk_tracking_digest_hash CHECK (((digest_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT chk_tracking_digest_period CHECK ((period_end >= period_start)),
    CONSTRAINT chk_tracking_first_latitude CHECK (((first_latitude IS NULL) OR ((first_latitude >= ('-90'::integer)::numeric) AND (first_latitude <= (90)::numeric)))),
    CONSTRAINT chk_tracking_first_longitude CHECK (((first_longitude IS NULL) OR ((first_longitude >= ('-180'::integer)::numeric) AND (first_longitude <= (180)::numeric)))),
    CONSTRAINT chk_tracking_last_latitude CHECK (((last_latitude IS NULL) OR ((last_latitude >= ('-90'::integer)::numeric) AND (last_latitude <= (90)::numeric)))),
    CONSTRAINT chk_tracking_last_longitude CHECK (((last_longitude IS NULL) OR ((last_longitude >= ('-180'::integer)::numeric) AND (last_longitude <= (180)::numeric)))),
    CONSTRAINT chk_tracking_previous_digest_hash CHECK (((previous_digest_hash IS NULL) OR ((previous_digest_hash)::text ~ '^[0-9a-f]{64}$'::text)))
);


--
-- Name: shipment_tracking_binding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_tracking_binding (
    binding_id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid NOT NULL,
    device_id uuid NOT NULL,
    transporter_org_id uuid NOT NULL,
    bound_at timestamp with time zone DEFAULT now() NOT NULL,
    unbound_at timestamp with time zone,
    status character varying(30) DEFAULT 'ACTIVE'::character varying NOT NULL,
    bound_by uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_tracking_binding_time CHECK (((unbound_at IS NULL) OR (unbound_at >= bound_at)))
);


--
-- Name: trace_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_event (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    cycle_id uuid,
    lot_id uuid,
    event_type character varying(100) NOT NULL,
    actor_user_id uuid,
    actor_organization_id uuid,
    actor_role character varying(50) NOT NULL,
    auth_proof_type character varying(100),
    actor_auth_proof text,
    event_time timestamp with time zone NOT NULL,
    server_recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    business_data jsonb NOT NULL,
    schema_version character varying(50) DEFAULT 'trace-event-1'::character varying NOT NULL,
    canonicalization_version character varying(50) DEFAULT 'RFC8785-JCS-v1'::character varying NOT NULL,
    data_hash character varying(64) NOT NULL,
    previous_event_hash character varying(64),
    supersedes_event_id uuid,
    causation_event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_trace_event_actor_auth CHECK (((actor_user_id IS NULL) OR ((auth_proof_type IS NOT NULL) AND (actor_auth_proof IS NOT NULL)))),
    CONSTRAINT chk_trace_event_data_hash CHECK (((data_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT chk_trace_event_not_self_cause CHECK (((causation_event_id IS NULL) OR (causation_event_id <> event_id))),
    CONSTRAINT chk_trace_event_not_self_supersede CHECK (((supersedes_event_id IS NULL) OR (supersedes_event_id <> event_id))),
    CONSTRAINT chk_trace_event_previous_hash CHECK (((previous_event_hash IS NULL) OR ((previous_event_hash)::text ~ '^[0-9a-f]{64}$'::text)))
);


--
-- Name: trace_qr; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trace_qr (
    trace_qr_id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    trace_token character varying(255) NOT NULL,
    trace_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_lot_trace_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_lot_trace_summary AS
 SELECT l.lot_id,
    l.lot_code,
    l.current_state AS lot_state,
    l.initial_quantity,
    l.available_quantity,
    l.unit,
    p.product_name,
    p.variety,
    o.name AS farm_organization,
    s.shipment_id,
    s.status AS shipment_state,
    s.transporter_org_id,
    s.retailer_org_id,
    s.pickup_time,
    s.arrival_time,
    s.received_time
   FROM (((public.lot l
     JOIN public.product p ON ((p.product_id = l.product_id)))
     JOIN public.organization o ON ((o.organization_id = l.farm_org_id)))
     LEFT JOIN public.shipment s ON ((s.lot_id = l.lot_id)));


--
-- Name: v_trace_event_verification; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_trace_event_verification AS
 SELECT te.event_id,
    te.entity_type,
    te.entity_id,
    te.cycle_id,
    te.lot_id,
    te.event_type,
    te.event_time,
    te.server_recorded_at,
    te.data_hash,
    bp.proof_id,
    bp.network,
    bp.tx_id,
    bp.transaction_status,
    bp.recorded_at,
        CASE
            WHEN (bp.proof_id IS NULL) THEN 'NO_PROOF'::text
            WHEN ((bp.data_hash)::text <> (te.data_hash)::text) THEN 'INTEGRITY_WARNING'::text
            WHEN (bp.transaction_status = 'COMMITTED'::public.blockchain_transaction_status) THEN 'VERIFIED'::text
            WHEN (bp.transaction_status = 'PENDING'::public.blockchain_transaction_status) THEN 'PENDING'::text
            ELSE 'BLOCKCHAIN_UNAVAILABLE'::text
        END AS verification_status
   FROM (public.trace_event te
     LEFT JOIN public.blockchain_proof bp ON ((bp.event_id = te.event_id)));


--
-- Name: app_role app_role_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_role
    ADD CONSTRAINT app_role_code_key UNIQUE (code);


--
-- Name: app_role app_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_role
    ADD CONSTRAINT app_role_pkey PRIMARY KEY (role_id);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (user_id);


--
-- Name: blockchain_proof blockchain_proof_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blockchain_proof
    ADD CONSTRAINT blockchain_proof_event_id_key UNIQUE (event_id);


--
-- Name: blockchain_proof blockchain_proof_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blockchain_proof
    ADD CONSTRAINT blockchain_proof_pkey PRIMARY KEY (proof_id);


--
-- Name: blockchain_proof blockchain_proof_tx_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blockchain_proof
    ADD CONSTRAINT blockchain_proof_tx_id_key UNIQUE (tx_id);


--
-- Name: care_record care_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.care_record
    ADD CONSTRAINT care_record_pkey PRIMARY KEY (care_id);


--
-- Name: certificate certificate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate
    ADD CONSTRAINT certificate_pkey PRIMARY KEY (certificate_id);


--
-- Name: farm farm_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farm
    ADD CONSTRAINT farm_pkey PRIMARY KEY (farm_id);


--
-- Name: harvest_event harvest_event_final_sensor_digest_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.harvest_event
    ADD CONSTRAINT harvest_event_final_sensor_digest_id_key UNIQUE (final_sensor_digest_id);


--
-- Name: harvest_event harvest_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.harvest_event
    ADD CONSTRAINT harvest_event_pkey PRIMARY KEY (harvest_id);


--
-- Name: idempotency_record idempotency_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_record
    ADD CONSTRAINT idempotency_record_pkey PRIMARY KEY (idempotency_record_id);


--
-- Name: inspection inspection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection
    ADD CONSTRAINT inspection_pkey PRIMARY KEY (inspection_id);


--
-- Name: iot_device iot_device_device_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iot_device
    ADD CONSTRAINT iot_device_device_code_key UNIQUE (device_code);


--
-- Name: iot_device iot_device_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iot_device
    ADD CONSTRAINT iot_device_pkey PRIMARY KEY (device_id);


--
-- Name: lot lot_harvest_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_harvest_id_key UNIQUE (harvest_id);


--
-- Name: lot lot_lot_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_lot_code_key UNIQUE (lot_code);


--
-- Name: lot lot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_pkey PRIMARY KEY (lot_id);


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (organization_id);


--
-- Name: plot plot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot
    ADD CONSTRAINT plot_pkey PRIMARY KEY (plot_id);


--
-- Name: product product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (product_id);


--
-- Name: production_cycle production_cycle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_cycle
    ADD CONSTRAINT production_cycle_pkey PRIMARY KEY (cycle_id);


--
-- Name: quantity_movement quantity_movement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_movement
    ADD CONSTRAINT quantity_movement_pkey PRIMARY KEY (movement_id);


--
-- Name: sensor_digest sensor_digest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sensor_digest
    ADD CONSTRAINT sensor_digest_pkey PRIMARY KEY (digest_id);


--
-- Name: sensor_reading sensor_reading_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sensor_reading
    ADD CONSTRAINT sensor_reading_pkey PRIMARY KEY (reading_id);


--
-- Name: shipment shipment_lot_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment
    ADD CONSTRAINT shipment_lot_id_key UNIQUE (lot_id);


--
-- Name: shipment shipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment
    ADD CONSTRAINT shipment_pkey PRIMARY KEY (shipment_id);


--
-- Name: shipment_telemetry_digest shipment_telemetry_digest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_telemetry_digest
    ADD CONSTRAINT shipment_telemetry_digest_pkey PRIMARY KEY (digest_id);


--
-- Name: shipment_telemetry shipment_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_telemetry
    ADD CONSTRAINT shipment_telemetry_pkey PRIMARY KEY (telemetry_id);


--
-- Name: shipment_tracking_binding shipment_tracking_binding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_tracking_binding
    ADD CONSTRAINT shipment_tracking_binding_pkey PRIMARY KEY (binding_id);


--
-- Name: trace_event trace_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_event
    ADD CONSTRAINT trace_event_pkey PRIMARY KEY (event_id);


--
-- Name: trace_qr trace_qr_lot_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_qr
    ADD CONSTRAINT trace_qr_lot_id_key UNIQUE (lot_id);


--
-- Name: trace_qr trace_qr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_qr
    ADD CONSTRAINT trace_qr_pkey PRIMARY KEY (trace_qr_id);


--
-- Name: trace_qr trace_qr_trace_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_qr
    ADD CONSTRAINT trace_qr_trace_token_key UNIQUE (trace_token);


--
-- Name: idempotency_record uq_idempotency_request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_record
    ADD CONSTRAINT uq_idempotency_request UNIQUE (requester_id, operation, idempotency_key);


--
-- Name: production_cycle uq_production_cycle_farm_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_cycle
    ADD CONSTRAINT uq_production_cycle_farm_code UNIQUE (farm_id, cycle_code);


--
-- Name: shipment_telemetry_digest uq_tracking_digest_window; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_telemetry_digest
    ADD CONSTRAINT uq_tracking_digest_window UNIQUE (shipment_id, period_start, period_end);


--
-- Name: ix_blockchain_proof_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_blockchain_proof_hash ON public.blockchain_proof USING btree (data_hash);


--
-- Name: ix_blockchain_proof_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_blockchain_proof_status ON public.blockchain_proof USING btree (transaction_status);


--
-- Name: ix_care_record_cycle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_care_record_cycle_time ON public.care_record USING btree (cycle_id, event_time);


--
-- Name: ix_certificate_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_certificate_cycle ON public.certificate USING btree (cycle_id);


--
-- Name: ix_certificate_lot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_certificate_lot ON public.certificate USING btree (lot_id);


--
-- Name: ix_farm_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_farm_organization ON public.farm USING btree (organization_id);


--
-- Name: ix_harvest_cycle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_harvest_cycle_time ON public.harvest_event USING btree (cycle_id, harvest_time);


--
-- Name: ix_idempotency_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_idempotency_expires ON public.idempotency_record USING btree (expires_at);


--
-- Name: ix_idempotency_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_idempotency_status ON public.idempotency_record USING btree (status);


--
-- Name: ix_inspection_lot_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inspection_lot_time ON public.inspection USING btree (lot_id, inspected_at);


--
-- Name: ix_iot_device_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_iot_device_cycle ON public.iot_device USING btree (cycle_id);


--
-- Name: ix_iot_device_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_iot_device_org ON public.iot_device USING btree (organization_id);


--
-- Name: ix_lot_farm_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_lot_farm_org ON public.lot USING btree (farm_org_id);


--
-- Name: ix_lot_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_lot_product ON public.lot USING btree (product_id);


--
-- Name: ix_lot_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_lot_state ON public.lot USING btree (current_state);


--
-- Name: ix_plot_farm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_plot_farm ON public.plot USING btree (farm_id);


--
-- Name: ix_production_cycle_farm_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_production_cycle_farm_org ON public.production_cycle USING btree (farm_org_id);


--
-- Name: ix_production_cycle_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_production_cycle_product ON public.production_cycle USING btree (product_id);


--
-- Name: ix_production_cycle_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_production_cycle_state ON public.production_cycle USING btree (current_state);


--
-- Name: ix_quantity_movement_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_quantity_movement_event ON public.quantity_movement USING btree (event_id);


--
-- Name: ix_quantity_movement_lot_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_quantity_movement_lot_time ON public.quantity_movement USING btree (lot_id, created_at);


--
-- Name: ix_sensor_digest_cycle_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sensor_digest_cycle_period ON public.sensor_digest USING btree (cycle_id, period_start, period_end);


--
-- Name: ix_sensor_digest_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sensor_digest_hash ON public.sensor_digest USING btree (digest_hash);


--
-- Name: ix_sensor_reading_cycle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sensor_reading_cycle_time ON public.sensor_reading USING btree (cycle_id, recorded_at);


--
-- Name: ix_sensor_reading_device_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sensor_reading_device_time ON public.sensor_reading USING btree (device_id, recorded_at);


--
-- Name: ix_shipment_retailer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_shipment_retailer ON public.shipment USING btree (retailer_org_id);


--
-- Name: ix_shipment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_shipment_status ON public.shipment USING btree (status);


--
-- Name: ix_shipment_telemetry_device_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_shipment_telemetry_device_time ON public.shipment_telemetry USING btree (device_id, recorded_at);


--
-- Name: ix_shipment_telemetry_ingest_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_shipment_telemetry_ingest_time ON public.shipment_telemetry USING btree (ingest_time);


--
-- Name: ix_shipment_telemetry_shipment_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_shipment_telemetry_shipment_time ON public.shipment_telemetry USING btree (shipment_id, recorded_at);


--
-- Name: ix_shipment_telemetry_validity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_shipment_telemetry_validity ON public.shipment_telemetry USING btree (validity_status);


--
-- Name: ix_shipment_transporter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_shipment_transporter ON public.shipment USING btree (transporter_org_id);


--
-- Name: ix_trace_event_cycle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trace_event_cycle_time ON public.trace_event USING btree (cycle_id, event_time);


--
-- Name: ix_trace_event_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trace_event_entity ON public.trace_event USING btree (entity_type, entity_id);


--
-- Name: ix_trace_event_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trace_event_hash ON public.trace_event USING btree (data_hash);


--
-- Name: ix_trace_event_lot_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trace_event_lot_time ON public.trace_event USING btree (lot_id, event_time);


--
-- Name: ix_trace_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trace_event_type ON public.trace_event USING btree (event_type);


--
-- Name: ix_tracking_binding_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tracking_binding_device ON public.shipment_tracking_binding USING btree (device_id);


--
-- Name: ix_tracking_binding_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tracking_binding_shipment ON public.shipment_tracking_binding USING btree (shipment_id);


--
-- Name: ix_tracking_digest_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tracking_digest_hash ON public.shipment_telemetry_digest USING btree (digest_hash);


--
-- Name: ix_tracking_digest_shipment_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tracking_digest_shipment_period ON public.shipment_telemetry_digest USING btree (shipment_id, period_start, period_end);


--
-- Name: ux_app_user_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_app_user_email_lower ON public.app_user USING btree (lower((email)::text));


--
-- Name: ux_shipment_telemetry_device_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_shipment_telemetry_device_sequence ON public.shipment_telemetry USING btree (device_id, device_sequence) WHERE (device_sequence IS NOT NULL);


--
-- Name: ux_shipment_telemetry_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_shipment_telemetry_idempotency ON public.shipment_telemetry USING btree (device_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: ux_tracking_binding_active_device; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_tracking_binding_active_device ON public.shipment_tracking_binding USING btree (device_id) WHERE ((unbound_at IS NULL) AND ((status)::text = 'ACTIVE'::text));


--
-- Name: ux_tracking_digest_final_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_tracking_digest_final_shipment ON public.shipment_telemetry_digest USING btree (shipment_id) WHERE (is_final = true);


--
-- Name: app_user trg_app_user_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_user_updated_at BEFORE UPDATE ON public.app_user FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: blockchain_proof trg_blockchain_proof_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_blockchain_proof_updated_at BEFORE UPDATE ON public.blockchain_proof FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: farm trg_farm_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_farm_updated_at BEFORE UPDATE ON public.farm FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: idempotency_record trg_idempotency_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_idempotency_updated_at BEFORE UPDATE ON public.idempotency_record FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: iot_device trg_iot_device_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_iot_device_updated_at BEFORE UPDATE ON public.iot_device FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: lot trg_lock_lot_origin_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lock_lot_origin_fields BEFORE UPDATE ON public.lot FOR EACH ROW EXECUTE FUNCTION public.fn_lock_lot_origin_fields();


--
-- Name: shipment trg_lock_shipment_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lock_shipment_assignment BEFORE UPDATE ON public.shipment FOR EACH ROW EXECUTE FUNCTION public.fn_lock_shipment_assignment();


--
-- Name: lot trg_lot_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lot_updated_at BEFORE UPDATE ON public.lot FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: organization trg_organization_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_organization_updated_at BEFORE UPDATE ON public.organization FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: plot trg_plot_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_plot_updated_at BEFORE UPDATE ON public.plot FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: product trg_product_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_updated_at BEFORE UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: production_cycle trg_production_cycle_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_production_cycle_updated_at BEFORE UPDATE ON public.production_cycle FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: production_cycle trg_set_cycle_farm_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_cycle_farm_org BEFORE INSERT OR UPDATE OF farm_id ON public.production_cycle FOR EACH ROW EXECUTE FUNCTION public.fn_set_cycle_farm_org();


--
-- Name: lot trg_set_lot_derived_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_lot_derived_fields BEFORE INSERT ON public.lot FOR EACH ROW EXECUTE FUNCTION public.fn_set_lot_derived_fields();


--
-- Name: shipment trg_shipment_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_shipment_updated_at BEFORE UPDATE ON public.shipment FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: trace_event trg_trace_event_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trace_event_no_delete BEFORE DELETE ON public.trace_event FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_trace_event_mutation();


--
-- Name: trace_event trg_trace_event_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trace_event_no_update BEFORE UPDATE ON public.trace_event FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_trace_event_mutation();


--
-- Name: shipment_tracking_binding trg_tracking_binding_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tracking_binding_updated_at BEFORE UPDATE ON public.shipment_tracking_binding FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: blockchain_proof trg_validate_blockchain_proof_hash; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_blockchain_proof_hash BEFORE INSERT OR UPDATE OF event_id, data_hash ON public.blockchain_proof FOR EACH ROW EXECUTE FUNCTION public.fn_validate_blockchain_proof_hash();


--
-- Name: shipment trg_validate_shipment_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_shipment_insert BEFORE INSERT ON public.shipment FOR EACH ROW EXECUTE FUNCTION public.fn_validate_shipment_insert();


--
-- Name: shipment_telemetry trg_validate_shipment_telemetry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_shipment_telemetry BEFORE INSERT ON public.shipment_telemetry FOR EACH ROW EXECUTE FUNCTION public.fn_validate_shipment_telemetry();


--
-- Name: shipment_tracking_binding trg_validate_tracking_binding; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_tracking_binding BEFORE INSERT OR UPDATE OF shipment_id, device_id, transporter_org_id ON public.shipment_tracking_binding FOR EACH ROW EXECUTE FUNCTION public.fn_validate_tracking_binding();


--
-- Name: app_user app_user_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: app_user app_user_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.app_role(role_id) ON DELETE RESTRICT;


--
-- Name: blockchain_proof blockchain_proof_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blockchain_proof
    ADD CONSTRAINT blockchain_proof_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.trace_event(event_id) ON DELETE RESTRICT;


--
-- Name: care_record care_record_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.care_record
    ADD CONSTRAINT care_record_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.production_cycle(cycle_id) ON DELETE RESTRICT;


--
-- Name: certificate certificate_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate
    ADD CONSTRAINT certificate_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.production_cycle(cycle_id) ON DELETE RESTRICT;


--
-- Name: certificate certificate_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificate
    ADD CONSTRAINT certificate_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lot(lot_id) ON DELETE RESTRICT;


--
-- Name: farm farm_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farm
    ADD CONSTRAINT farm_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: harvest_event harvest_event_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.harvest_event
    ADD CONSTRAINT harvest_event_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.production_cycle(cycle_id) ON DELETE RESTRICT;


--
-- Name: harvest_event harvest_event_final_sensor_digest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.harvest_event
    ADD CONSTRAINT harvest_event_final_sensor_digest_id_fkey FOREIGN KEY (final_sensor_digest_id) REFERENCES public.sensor_digest(digest_id) ON DELETE RESTRICT;


--
-- Name: inspection inspection_inspector_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection
    ADD CONSTRAINT inspection_inspector_org_id_fkey FOREIGN KEY (inspector_org_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: inspection inspection_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection
    ADD CONSTRAINT inspection_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lot(lot_id) ON DELETE RESTRICT;


--
-- Name: iot_device iot_device_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iot_device
    ADD CONSTRAINT iot_device_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.production_cycle(cycle_id) ON DELETE RESTRICT;


--
-- Name: iot_device iot_device_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iot_device
    ADD CONSTRAINT iot_device_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: lot lot_farm_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_farm_org_id_fkey FOREIGN KEY (farm_org_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: lot lot_harvest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_harvest_id_fkey FOREIGN KEY (harvest_id) REFERENCES public.harvest_event(harvest_id) ON DELETE RESTRICT;


--
-- Name: lot lot_parent_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_parent_lot_id_fkey FOREIGN KEY (parent_lot_id) REFERENCES public.lot(lot_id) ON DELETE RESTRICT;


--
-- Name: lot lot_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(product_id) ON DELETE RESTRICT;


--
-- Name: plot plot_farm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot
    ADD CONSTRAINT plot_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farm(farm_id) ON DELETE RESTRICT;


--
-- Name: production_cycle production_cycle_farm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_cycle
    ADD CONSTRAINT production_cycle_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farm(farm_id) ON DELETE RESTRICT;


--
-- Name: production_cycle production_cycle_farm_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_cycle
    ADD CONSTRAINT production_cycle_farm_org_id_fkey FOREIGN KEY (farm_org_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: production_cycle production_cycle_plot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_cycle
    ADD CONSTRAINT production_cycle_plot_id_fkey FOREIGN KEY (plot_id) REFERENCES public.plot(plot_id) ON DELETE RESTRICT;


--
-- Name: production_cycle production_cycle_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_cycle
    ADD CONSTRAINT production_cycle_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.product(product_id) ON DELETE RESTRICT;


--
-- Name: quantity_movement quantity_movement_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_movement
    ADD CONSTRAINT quantity_movement_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.trace_event(event_id) ON DELETE RESTRICT;


--
-- Name: quantity_movement quantity_movement_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quantity_movement
    ADD CONSTRAINT quantity_movement_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lot(lot_id) ON DELETE RESTRICT;


--
-- Name: sensor_digest sensor_digest_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sensor_digest
    ADD CONSTRAINT sensor_digest_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.production_cycle(cycle_id) ON DELETE RESTRICT;


--
-- Name: sensor_reading sensor_reading_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sensor_reading
    ADD CONSTRAINT sensor_reading_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.production_cycle(cycle_id) ON DELETE RESTRICT;


--
-- Name: sensor_reading sensor_reading_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sensor_reading
    ADD CONSTRAINT sensor_reading_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.iot_device(device_id) ON DELETE RESTRICT;


--
-- Name: shipment shipment_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment
    ADD CONSTRAINT shipment_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lot(lot_id) ON DELETE RESTRICT;


--
-- Name: shipment shipment_retailer_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment
    ADD CONSTRAINT shipment_retailer_org_id_fkey FOREIGN KEY (retailer_org_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: shipment_telemetry shipment_telemetry_binding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_telemetry
    ADD CONSTRAINT shipment_telemetry_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.shipment_tracking_binding(binding_id) ON DELETE RESTRICT;


--
-- Name: shipment_telemetry shipment_telemetry_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_telemetry
    ADD CONSTRAINT shipment_telemetry_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.iot_device(device_id) ON DELETE RESTRICT;


--
-- Name: shipment_telemetry_digest shipment_telemetry_digest_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_telemetry_digest
    ADD CONSTRAINT shipment_telemetry_digest_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.iot_device(device_id) ON DELETE RESTRICT;


--
-- Name: shipment_telemetry_digest shipment_telemetry_digest_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_telemetry_digest
    ADD CONSTRAINT shipment_telemetry_digest_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipment(shipment_id) ON DELETE RESTRICT;


--
-- Name: shipment_telemetry shipment_telemetry_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_telemetry
    ADD CONSTRAINT shipment_telemetry_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipment(shipment_id) ON DELETE RESTRICT;


--
-- Name: shipment_tracking_binding shipment_tracking_binding_bound_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_tracking_binding
    ADD CONSTRAINT shipment_tracking_binding_bound_by_fkey FOREIGN KEY (bound_by) REFERENCES public.app_user(user_id) ON DELETE RESTRICT;


--
-- Name: shipment_tracking_binding shipment_tracking_binding_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_tracking_binding
    ADD CONSTRAINT shipment_tracking_binding_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.iot_device(device_id) ON DELETE RESTRICT;


--
-- Name: shipment_tracking_binding shipment_tracking_binding_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_tracking_binding
    ADD CONSTRAINT shipment_tracking_binding_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipment(shipment_id) ON DELETE RESTRICT;


--
-- Name: shipment_tracking_binding shipment_tracking_binding_transporter_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_tracking_binding
    ADD CONSTRAINT shipment_tracking_binding_transporter_org_id_fkey FOREIGN KEY (transporter_org_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: shipment shipment_transporter_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment
    ADD CONSTRAINT shipment_transporter_org_id_fkey FOREIGN KEY (transporter_org_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: trace_event trace_event_actor_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_event
    ADD CONSTRAINT trace_event_actor_organization_id_fkey FOREIGN KEY (actor_organization_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: trace_event trace_event_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_event
    ADD CONSTRAINT trace_event_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.app_user(user_id) ON DELETE RESTRICT;


--
-- Name: trace_event trace_event_causation_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_event
    ADD CONSTRAINT trace_event_causation_event_id_fkey FOREIGN KEY (causation_event_id) REFERENCES public.trace_event(event_id) ON DELETE RESTRICT;


--
-- Name: trace_event trace_event_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_event
    ADD CONSTRAINT trace_event_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.production_cycle(cycle_id) ON DELETE RESTRICT;


--
-- Name: trace_event trace_event_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_event
    ADD CONSTRAINT trace_event_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lot(lot_id) ON DELETE RESTRICT;


--
-- Name: trace_event trace_event_supersedes_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_event
    ADD CONSTRAINT trace_event_supersedes_event_id_fkey FOREIGN KEY (supersedes_event_id) REFERENCES public.trace_event(event_id) ON DELETE RESTRICT;


--
-- Name: trace_qr trace_qr_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trace_qr
    ADD CONSTRAINT trace_qr_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lot(lot_id) ON DELETE RESTRICT;


-- Seed the roles required by authentication and authorization.
INSERT INTO public.app_role (code, name, description)
VALUES
    ('SYSTEM_ADMIN', 'Quản trị hệ thống', 'Quản trị tài khoản, phân quyền và cấu hình hệ thống'),
    ('FARM_STAFF', 'Nhân viên trang trại/HTX', 'Ghi nhận sản xuất, chăm sóc và thu hoạch'),
    ('TRANSPORTER', 'Đơn vị vận chuyển', 'Quản lý vận chuyển và dữ liệu theo dõi hành trình'),
    ('RETAILER', 'Nhà bán lẻ', 'Tiếp nhận và phân phối lô nông sản'),
    ('AUDITOR', 'Người kiểm tra', 'Kiểm tra dữ liệu truy xuất và tính toàn vẹn')
ON CONFLICT (code) DO NOTHING;


--
-- PostgreSQL database dump complete
--
