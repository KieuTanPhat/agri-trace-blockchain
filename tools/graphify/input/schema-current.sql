-- Graphify analysis input. Do not execute this file as a migration.
-- Source: apps/api/prisma/schema.prisma
-- Source SHA-256: a3b2aa045b2361ad14954986bed772fc0082d3b4f463c31f7df1306d86c66ffa
-- Prisma-supported DDL only; custom PostgreSQL rules are documented in docs/graphify-context.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "blockchain_transaction_status" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "blockchain_outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "inspection_result" AS ENUM ('PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "lot_state" AS ENUM ('HARVESTED', 'IN_TRANSPORT', 'ARRIVED', 'RETAIL_RECEIVED', 'FOR_SALE', 'SOLD', 'RECALLED', 'EXPIRED', 'DAMAGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "organization_type" AS ENUM ('FARM', 'TRANSPORTER', 'RETAILER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "production_cycle_state" AS ENUM ('CREATED', 'PLANTED', 'GROWING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "shipment_state" AS ENUM ('CREATED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "app_role" (
    "role_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,

    CONSTRAINT "app_role_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "user_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "role_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "account_status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "refresh_session" (
    "refresh_session_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_session_pkey" PRIMARY KEY ("refresh_session_id")
);

-- CreateTable
CREATE TABLE "organization" (
    "organization_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "type" "organization_type" NOT NULL,
    "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "farm" (
    "farm_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "location" TEXT,
    "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_pkey" PRIMARY KEY ("farm_id")
);

-- CreateTable
CREATE TABLE "plot" (
    "plot_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "farm_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "area" DECIMAL(12,2),
    "unit" VARCHAR(30),
    "location" TEXT,
    "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plot_pkey" PRIMARY KEY ("plot_id")
);

-- CreateTable
CREATE TABLE "product" (
    "product_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_name" VARCHAR(255) NOT NULL,
    "variety" VARCHAR(255),
    "default_unit" VARCHAR(30),
    "description" TEXT,
    "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "production_cycle" (
    "cycle_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_code" VARCHAR(100) NOT NULL,
    "product_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "farm_org_id" UUID NOT NULL,
    "plot_id" UUID,
    "start_date" DATE,
    "planned_harvest" DATE,
    "max_harvest_quantity" DECIMAL(14,3),
    "harvest_unit" VARCHAR(30),
    "current_state" "production_cycle_state" NOT NULL DEFAULT 'CREATED',
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_cycle_pkey" PRIMARY KEY ("cycle_id")
);

-- CreateTable
CREATE TABLE "care_record" (
    "care_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "care_type" VARCHAR(100) NOT NULL,
    "event_time" TIMESTAMPTZ(6) NOT NULL,
    "material_name" VARCHAR(255),
    "active_ingredient" VARCHAR(255),
    "quantity" DECIMAL(14,4),
    "unit" VARCHAR(30),
    "method" VARCHAR(255),
    "application_area" VARCHAR(255),
    "withdrawal_period" INTEGER,
    "note" TEXT,
    "evidence_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_record_pkey" PRIMARY KEY ("care_id")
);

-- CreateTable
CREATE TABLE "iot_device" (
    "device_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID,
    "device_code" VARCHAR(120) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "status" "device_status" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iot_device_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "sensor_reading" (
    "reading_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "device_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "sensor_type" VARCHAR(100) NOT NULL,
    "value" DECIMAL(16,6) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "ingest_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_reading_pkey" PRIMARY KEY ("reading_id")
);

-- CreateTable
CREATE TABLE "sensor_digest" (
    "digest_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "reading_count" INTEGER NOT NULL,
    "digest_hash" VARCHAR(64) NOT NULL,
    "schema_version" VARCHAR(50) NOT NULL DEFAULT 'sensor-digest-1',
    "canonicalization_version" VARCHAR(50) NOT NULL DEFAULT 'RFC8785-JCS-v1',
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_digest_pkey" PRIMARY KEY ("digest_id")
);

-- CreateTable
CREATE TABLE "harvest_event" (
    "harvest_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycle_id" UUID NOT NULL,
    "final_sensor_digest_id" UUID,
    "harvest_time" TIMESTAMPTZ(6) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "quality_note" TEXT,
    "grade" VARCHAR(100),
    "harvest_area" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harvest_event_pkey" PRIMARY KEY ("harvest_id")
);

-- CreateTable
CREATE TABLE "lot" (
    "lot_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_code" VARCHAR(120) NOT NULL,
    "harvest_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "farm_org_id" UUID NOT NULL,
    "initial_quantity" DECIMAL(14,3) NOT NULL,
    "available_quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "grade" VARCHAR(100),
    "expiry_date" DATE,
    "current_state" "lot_state" NOT NULL DEFAULT 'HARVESTED',
    "parent_lot_id" UUID,
    "lineage_type" VARCHAR(100),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("lot_id")
);

-- CreateTable
CREATE TABLE "shipment" (
    "shipment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_id" UUID NOT NULL,
    "transporter_org_id" UUID NOT NULL,
    "retailer_org_id" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "shipped_quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "planned_pickup_time" TIMESTAMPTZ(6),
    "expected_arrival_time" TIMESTAMPTZ(6),
    "pickup_time" TIMESTAMPTZ(6),
    "arrival_time" TIMESTAMPTZ(6),
    "received_time" TIMESTAMPTZ(6),
    "received_quantity" DECIMAL(14,3),
    "rejected_quantity" DECIMAL(14,3),
    "reject_reason" TEXT,
    "vehicle_ref" VARCHAR(255),
    "conditions" JSONB,
    "status" "shipment_state" NOT NULL DEFAULT 'CREATED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_pkey" PRIMARY KEY ("shipment_id")
);

-- CreateTable
CREATE TABLE "shipment_tracking_binding" (
    "binding_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "transporter_org_id" UUID NOT NULL,
    "bound_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unbound_at" TIMESTAMPTZ(6),
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "bound_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_tracking_binding_pkey" PRIMARY KEY ("binding_id")
);

-- CreateTable
CREATE TABLE "shipment_telemetry" (
    "telemetry_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "binding_id" UUID NOT NULL,
    "device_sequence" BIGINT,
    "idempotency_key" VARCHAR(150),
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "accuracy" DECIMAL(10,3),
    "speed" DECIMAL(12,3),
    "heading" DECIMAL(7,3),
    "temperature" DECIMAL(10,3),
    "humidity" DECIMAL(10,3),
    "battery" DECIMAL(6,2),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "ingest_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validity_status" VARCHAR(30),
    "anomaly_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_telemetry_pkey" PRIMARY KEY ("telemetry_id")
);

-- CreateTable
CREATE TABLE "shipment_telemetry_digest" (
    "digest_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "device_id" UUID,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "reading_count" INTEGER NOT NULL,
    "first_latitude" DECIMAL(9,6),
    "first_longitude" DECIMAL(9,6),
    "last_latitude" DECIMAL(9,6),
    "last_longitude" DECIMAL(9,6),
    "condition_summary" JSONB,
    "anomaly_summary" JSONB,
    "digest_hash" VARCHAR(64) NOT NULL,
    "previous_digest_hash" VARCHAR(64),
    "schema_version" VARCHAR(50) NOT NULL DEFAULT 'shipment-telemetry-digest-1',
    "canonicalization_version" VARCHAR(50) NOT NULL DEFAULT 'RFC8785-JCS-v1',
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_telemetry_digest_pkey" PRIMARY KEY ("digest_id")
);

-- CreateTable
CREATE TABLE "trace_event" (
    "event_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "cycle_id" UUID,
    "lot_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "actor_user_id" UUID,
    "actor_organization_id" UUID,
    "actor_role" VARCHAR(50) NOT NULL,
    "auth_proof_type" VARCHAR(100),
    "actor_auth_proof" TEXT,
    "event_time" TIMESTAMPTZ(6) NOT NULL,
    "server_recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_data" JSONB NOT NULL,
    "schema_version" VARCHAR(50) NOT NULL DEFAULT '2.0.0',
    "canonicalization_version" VARCHAR(50) NOT NULL DEFAULT 'RFC8785',
    "data_hash" VARCHAR(64) NOT NULL,
    "previous_event_hash" VARCHAR(64),
    "supersedes_event_id" UUID,
    "causation_event_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "blockchain_proof" (
    "proof_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "network" VARCHAR(100) NOT NULL,
    "channel_id" VARCHAR(100) NOT NULL DEFAULT 'agritrace',
    "tx_id" VARCHAR(255),
    "data_hash" VARCHAR(64) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6),
    "relayer_address" VARCHAR(255),
    "transaction_status" "blockchain_transaction_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_proof_pkey" PRIMARY KEY ("proof_id")
);

-- CreateTable
CREATE TABLE "blockchain_outbox" (
    "outbox_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "status" "blockchain_outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_outbox_pkey" PRIMARY KEY ("outbox_id")
);

-- CreateTable
CREATE TABLE "quantity_movement" (
    "movement_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "before_qty" DECIMAL(14,3) NOT NULL,
    "delta" DECIMAL(14,3) NOT NULL,
    "after_qty" DECIMAL(14,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quantity_movement_pkey" PRIMARY KEY ("movement_id")
);

-- CreateTable
CREATE TABLE "certificate" (
    "certificate_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_id" UUID,
    "cycle_id" UUID,
    "type" VARCHAR(120) NOT NULL,
    "issuer" VARCHAR(255) NOT NULL,
    "issue_date" DATE NOT NULL,
    "expiry_date" DATE,
    "document_ref" TEXT NOT NULL,
    "document_hash" VARCHAR(128) NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_pkey" PRIMARY KEY ("certificate_id")
);

-- CreateTable
CREATE TABLE "inspection" (
    "inspection_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_id" UUID NOT NULL,
    "inspector_org_id" UUID,
    "result" "inspection_result" NOT NULL,
    "note" TEXT,
    "inspected_at" TIMESTAMPTZ(6) NOT NULL,
    "evidence_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_pkey" PRIMARY KEY ("inspection_id")
);

-- CreateTable
CREATE TABLE "trace_qr" (
    "trace_qr_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_id" UUID NOT NULL,
    "trace_token" VARCHAR(255) NOT NULL,
    "trace_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_qr_pkey" PRIMARY KEY ("trace_qr_id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "idempotency_record_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "request_type" VARCHAR(100) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'PROCESSING',
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_id" VARCHAR(255),
    "requester_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("idempotency_record_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_role_code_key" ON "app_role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_session_token_hash_key" ON "refresh_session"("token_hash");

-- CreateIndex
CREATE INDEX "ix_refresh_session_user_active" ON "refresh_session"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "ix_refresh_session_expiry" ON "refresh_session"("expires_at");

-- CreateIndex
CREATE INDEX "ix_farm_organization" ON "farm"("organization_id");

-- CreateIndex
CREATE INDEX "ix_plot_farm" ON "plot"("farm_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_plot_farm_name" ON "plot"("farm_id", "name");

-- CreateIndex
CREATE INDEX "ix_production_cycle_farm_org" ON "production_cycle"("farm_org_id");

-- CreateIndex
CREATE INDEX "ix_production_cycle_product" ON "production_cycle"("product_id");

-- CreateIndex
CREATE INDEX "ix_production_cycle_state" ON "production_cycle"("current_state");

-- CreateIndex
CREATE UNIQUE INDEX "uq_production_cycle_farm_code" ON "production_cycle"("farm_id", "cycle_code");

-- CreateIndex
CREATE INDEX "ix_care_record_cycle_time" ON "care_record"("cycle_id", "event_time");

-- CreateIndex
CREATE UNIQUE INDEX "iot_device_device_code_key" ON "iot_device"("device_code");

-- CreateIndex
CREATE INDEX "ix_iot_device_cycle" ON "iot_device"("cycle_id");

-- CreateIndex
CREATE INDEX "ix_iot_device_org" ON "iot_device"("organization_id");

-- CreateIndex
CREATE INDEX "ix_sensor_reading_cycle_time" ON "sensor_reading"("cycle_id", "recorded_at");

-- CreateIndex
CREATE INDEX "ix_sensor_reading_device_time" ON "sensor_reading"("device_id", "recorded_at");

-- CreateIndex
CREATE INDEX "ix_sensor_digest_cycle_period" ON "sensor_digest"("cycle_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "ix_sensor_digest_hash" ON "sensor_digest"("digest_hash");

-- CreateIndex
CREATE UNIQUE INDEX "harvest_event_final_sensor_digest_id_key" ON "harvest_event"("final_sensor_digest_id");

-- CreateIndex
CREATE INDEX "ix_harvest_cycle_time" ON "harvest_event"("cycle_id", "harvest_time");

-- CreateIndex
CREATE UNIQUE INDEX "lot_lot_code_key" ON "lot"("lot_code");

-- CreateIndex
CREATE UNIQUE INDEX "lot_harvest_id_key" ON "lot"("harvest_id");

-- CreateIndex
CREATE INDEX "ix_lot_farm_org" ON "lot"("farm_org_id");

-- CreateIndex
CREATE INDEX "ix_lot_product" ON "lot"("product_id");

-- CreateIndex
CREATE INDEX "ix_lot_state" ON "lot"("current_state");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_lot_id_key" ON "shipment"("lot_id");

-- CreateIndex
CREATE INDEX "ix_shipment_retailer" ON "shipment"("retailer_org_id");

-- CreateIndex
CREATE INDEX "ix_shipment_status" ON "shipment"("status");

-- CreateIndex
CREATE INDEX "ix_shipment_transporter" ON "shipment"("transporter_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tracking_binding_active_device" ON "shipment_tracking_binding"("device_id") WHERE ((unbound_at IS NULL) AND ((status)::text = 'ACTIVE'::text));

-- CreateIndex
CREATE INDEX "ix_tracking_binding_device" ON "shipment_tracking_binding"("device_id");

-- CreateIndex
CREATE INDEX "ix_tracking_binding_shipment" ON "shipment_tracking_binding"("shipment_id");

-- CreateIndex
CREATE INDEX "ix_shipment_telemetry_device_time" ON "shipment_telemetry"("device_id", "recorded_at");

-- CreateIndex
CREATE INDEX "ix_shipment_telemetry_ingest_time" ON "shipment_telemetry"("ingest_time");

-- CreateIndex
CREATE INDEX "ix_shipment_telemetry_shipment_time" ON "shipment_telemetry"("shipment_id", "recorded_at");

-- CreateIndex
CREATE INDEX "ix_shipment_telemetry_validity" ON "shipment_telemetry"("validity_status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipment_telemetry_device_sequence" ON "shipment_telemetry"("device_id", "device_sequence") WHERE (device_sequence IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipment_telemetry_idempotency" ON "shipment_telemetry"("device_id", "idempotency_key") WHERE (idempotency_key IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_tracking_digest_final_shipment" ON "shipment_telemetry_digest"("shipment_id") WHERE (is_final = true);

-- CreateIndex
CREATE INDEX "ix_tracking_digest_hash" ON "shipment_telemetry_digest"("digest_hash");

-- CreateIndex
CREATE INDEX "ix_tracking_digest_shipment_period" ON "shipment_telemetry_digest"("shipment_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tracking_digest_window" ON "shipment_telemetry_digest"("shipment_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "ix_trace_event_cycle_time" ON "trace_event"("cycle_id", "event_time");

-- CreateIndex
CREATE INDEX "ix_trace_event_entity" ON "trace_event"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "ix_trace_event_hash" ON "trace_event"("data_hash");

-- CreateIndex
CREATE INDEX "ix_trace_event_lot_time" ON "trace_event"("lot_id", "event_time");

-- CreateIndex
CREATE INDEX "ix_trace_event_type" ON "trace_event"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_proof_event_id_key" ON "blockchain_proof"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_proof_tx_id_key" ON "blockchain_proof"("tx_id");

-- CreateIndex
CREATE INDEX "ix_blockchain_proof_hash" ON "blockchain_proof"("data_hash");

-- CreateIndex
CREATE INDEX "ix_blockchain_proof_status" ON "blockchain_proof"("transaction_status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_outbox_event_id_key" ON "blockchain_outbox"("event_id");

-- CreateIndex
CREATE INDEX "ix_blockchain_outbox_due" ON "blockchain_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "ix_blockchain_outbox_lease" ON "blockchain_outbox"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "ix_quantity_movement_event" ON "quantity_movement"("event_id");

-- CreateIndex
CREATE INDEX "ix_quantity_movement_lot_time" ON "quantity_movement"("lot_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_certificate_cycle" ON "certificate"("cycle_id");

-- CreateIndex
CREATE INDEX "ix_certificate_lot" ON "certificate"("lot_id");

-- CreateIndex
CREATE INDEX "ix_certificate_status" ON "certificate"("status");

-- CreateIndex
CREATE INDEX "ix_inspection_lot_time" ON "inspection"("lot_id", "inspected_at");

-- CreateIndex
CREATE UNIQUE INDEX "trace_qr_lot_id_key" ON "trace_qr"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "trace_qr_trace_token_key" ON "trace_qr"("trace_token");

-- CreateIndex
CREATE INDEX "ix_idempotency_expires" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE INDEX "ix_idempotency_status" ON "idempotency_record"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_idempotency_request" ON "idempotency_record"("requester_id", "operation", "idempotency_key");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "app_role"("role_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refresh_session" ADD CONSTRAINT "refresh_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "farm" ADD CONSTRAINT "farm_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "plot" ADD CONSTRAINT "plot_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farm"("farm_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_cycle" ADD CONSTRAINT "production_cycle_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farm"("farm_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_cycle" ADD CONSTRAINT "production_cycle_farm_org_id_fkey" FOREIGN KEY ("farm_org_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_cycle" ADD CONSTRAINT "production_cycle_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plot"("plot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "production_cycle" ADD CONSTRAINT "production_cycle_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "care_record" ADD CONSTRAINT "care_record_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycle"("cycle_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "iot_device" ADD CONSTRAINT "iot_device_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycle"("cycle_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "iot_device" ADD CONSTRAINT "iot_device_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sensor_reading" ADD CONSTRAINT "sensor_reading_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycle"("cycle_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sensor_reading" ADD CONSTRAINT "sensor_reading_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "iot_device"("device_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sensor_digest" ADD CONSTRAINT "sensor_digest_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycle"("cycle_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "harvest_event" ADD CONSTRAINT "harvest_event_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycle"("cycle_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "harvest_event" ADD CONSTRAINT "harvest_event_final_sensor_digest_id_fkey" FOREIGN KEY ("final_sensor_digest_id") REFERENCES "sensor_digest"("digest_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_farm_org_id_fkey" FOREIGN KEY ("farm_org_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_harvest_id_fkey" FOREIGN KEY ("harvest_id") REFERENCES "harvest_event"("harvest_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_parent_lot_id_fkey" FOREIGN KEY ("parent_lot_id") REFERENCES "lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_retailer_org_id_fkey" FOREIGN KEY ("retailer_org_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_transporter_org_id_fkey" FOREIGN KEY ("transporter_org_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_tracking_binding" ADD CONSTRAINT "shipment_tracking_binding_bound_by_fkey" FOREIGN KEY ("bound_by") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_tracking_binding" ADD CONSTRAINT "shipment_tracking_binding_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "iot_device"("device_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_tracking_binding" ADD CONSTRAINT "shipment_tracking_binding_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipment"("shipment_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_tracking_binding" ADD CONSTRAINT "shipment_tracking_binding_transporter_org_id_fkey" FOREIGN KEY ("transporter_org_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_telemetry" ADD CONSTRAINT "shipment_telemetry_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "shipment_tracking_binding"("binding_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_telemetry" ADD CONSTRAINT "shipment_telemetry_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "iot_device"("device_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_telemetry" ADD CONSTRAINT "shipment_telemetry_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipment"("shipment_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_telemetry_digest" ADD CONSTRAINT "shipment_telemetry_digest_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "iot_device"("device_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shipment_telemetry_digest" ADD CONSTRAINT "shipment_telemetry_digest_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipment"("shipment_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trace_event" ADD CONSTRAINT "trace_event_actor_organization_id_fkey" FOREIGN KEY ("actor_organization_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trace_event" ADD CONSTRAINT "trace_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trace_event" ADD CONSTRAINT "trace_event_causation_event_id_fkey" FOREIGN KEY ("causation_event_id") REFERENCES "trace_event"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trace_event" ADD CONSTRAINT "trace_event_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycle"("cycle_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trace_event" ADD CONSTRAINT "trace_event_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trace_event" ADD CONSTRAINT "trace_event_supersedes_event_id_fkey" FOREIGN KEY ("supersedes_event_id") REFERENCES "trace_event"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "blockchain_proof" ADD CONSTRAINT "blockchain_proof_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "trace_event"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "blockchain_outbox" ADD CONSTRAINT "blockchain_outbox_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "trace_event"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quantity_movement" ADD CONSTRAINT "quantity_movement_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "trace_event"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quantity_movement" ADD CONSTRAINT "quantity_movement_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycle"("cycle_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_inspector_org_id_fkey" FOREIGN KEY ("inspector_org_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "trace_qr" ADD CONSTRAINT "trace_qr_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
