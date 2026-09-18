-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('FARM', 'TRANSPORTER', 'RETAILER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FarmStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PlotStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductionCycleState" AS ENUM ('CREATED', 'PLANTED', 'GROWING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CareType" AS ENUM ('WATERING', 'FERTILIZING', 'PEST_CONTROL', 'WEEDING', 'GROWTH_CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('TEMPERATURE', 'HUMIDITY', 'TEMPERATURE_HUMIDITY', 'SOIL_MOISTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LotState" AS ENUM ('HARVESTED', 'IN_TRANSPORT', 'ARRIVED', 'RETAIL_RECEIVED', 'FOR_SALE', 'SOLD', 'RECALLED', 'EXPIRED', 'DAMAGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LineageType" AS ENUM ('ORIGINAL', 'SPLIT', 'MERGED', 'TRANSFORMED');

-- CreateEnum
CREATE TYPE "ShipmentState" AS ENUM ('CREATED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'FAIL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "TraceEntityType" AS ENUM ('PRODUCTION_CYCLE', 'CARE', 'SENSOR', 'HARVEST', 'LOT', 'SHIPMENT', 'INSPECTION', 'CERTIFICATE');

-- CreateEnum
CREATE TYPE "TraceEventType" AS ENUM ('PRODUCTION_CYCLE_CREATED', 'PLANTING_RECORDED', 'CARE_RECORDED', 'SENSOR_RECORDED', 'HARVEST_RECORDED', 'PRODUCTION_CYCLE_COMPLETED', 'INSPECTION_RECORDED', 'CERTIFICATE_ATTACHED', 'SHIPMENT_CREATED', 'TRANSPORT_STARTED', 'TRANSPORT_ARRIVED', 'PARTIAL_DAMAGE_RECORDED', 'DAMAGE_RECORDED', 'RETAIL_RECEIVED', 'RETAIL_REJECTED', 'MARKED_FOR_SALE', 'LOT_SOLD', 'RECALL_RECORDED', 'LOT_EXPIRED', 'ENTITY_CANCELLED', 'CORRECTION_RECORDED');

-- CreateEnum
CREATE TYPE "AuthProofType" AS ENUM ('DIGITAL_SIGNATURE', 'SIGNED_ASSERTION', 'TOKEN_FINGERPRINT', 'DEVICE_SIGNATURE', 'SYSTEM_ASSERTION');

-- CreateEnum
CREATE TYPE "BlockchainTransactionStatus" AS ENUM ('PENDING', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "QuantityMovementType" AS ENUM ('HARVEST', 'SHIPMENT', 'DAMAGE', 'RECEIPT', 'REJECTION', 'SALE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "role_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "role_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255),
    "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "products" (
    "product_id" UUID NOT NULL,
    "product_name" VARCHAR(255) NOT NULL,
    "variety" VARCHAR(255),
    "default_unit" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "farms" (
    "farm_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "location" TEXT,
    "status" "FarmStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("farm_id")
);

-- CreateTable
CREATE TABLE "plots" (
    "plot_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "area" DECIMAL(18,3),
    "unit" VARCHAR(50),
    "location" TEXT,
    "status" "PlotStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plots_pkey" PRIMARY KEY ("plot_id")
);

-- CreateTable
CREATE TABLE "production_cycles" (
    "cycle_id" UUID NOT NULL,
    "cycle_code" VARCHAR(100) NOT NULL,
    "product_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "plot_id" UUID,
    "start_date" TIMESTAMPTZ(3),
    "planned_harvest" TIMESTAMPTZ(3),
    "current_state" "ProductionCycleState" NOT NULL DEFAULT 'CREATED',
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_cycles_pkey" PRIMARY KEY ("cycle_id")
);

-- CreateTable
CREATE TABLE "care_records" (
    "care_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "care_type" "CareType" NOT NULL,
    "event_time" TIMESTAMPTZ(3) NOT NULL,
    "material_name" VARCHAR(255),
    "active_ingredient" VARCHAR(255),
    "quantity" DECIMAL(18,3),
    "unit" VARCHAR(50),
    "withdrawal_period" INTEGER,
    "note" TEXT,
    "evidence_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_records_pkey" PRIMARY KEY ("care_id")
);

-- CreateTable
CREATE TABLE "iot_devices" (
    "device_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID,
    "device_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255),
    "type" "DeviceType" NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "iot_devices_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "sensor_readings" (
    "reading_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "sensor_type" VARCHAR(100) NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "ingest_time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_readings_pkey" PRIMARY KEY ("reading_id")
);

-- CreateTable
CREATE TABLE "sensor_digests" (
    "digest_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "reading_count" INTEGER NOT NULL,
    "digest_hash" CHAR(64) NOT NULL,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_digests_pkey" PRIMARY KEY ("digest_id")
);

-- CreateTable
CREATE TABLE "harvest_events" (
    "harvest_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "final_sensor_digest_id" UUID,
    "harvest_time" TIMESTAMPTZ(3) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "quality_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harvest_events_pkey" PRIMARY KEY ("harvest_id")
);

-- CreateTable
CREATE TABLE "lots" (
    "lot_id" UUID NOT NULL,
    "lot_code" VARCHAR(100) NOT NULL,
    "harvest_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "farm_org_id" UUID NOT NULL,
    "initial_quantity" DECIMAL(18,3) NOT NULL,
    "available_quantity" DECIMAL(18,3) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "current_state" "LotState" NOT NULL DEFAULT 'HARVESTED',
    "parent_lot_id" UUID,
    "lineage_type" "LineageType" NOT NULL DEFAULT 'ORIGINAL',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("lot_id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "shipment_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "transporter_org_id" UUID NOT NULL,
    "retailer_org_id" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "shipped_quantity" DECIMAL(18,3) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "planned_pickup_time" TIMESTAMPTZ(3),
    "expected_arrival_time" TIMESTAMPTZ(3),
    "pickup_time" TIMESTAMPTZ(3),
    "arrival_time" TIMESTAMPTZ(3),
    "received_time" TIMESTAMPTZ(3),
    "received_quantity" DECIMAL(18,3),
    "rejected_quantity" DECIMAL(18,3),
    "reject_reason" TEXT,
    "status" "ShipmentState" NOT NULL DEFAULT 'CREATED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("shipment_id")
);

-- CreateTable
CREATE TABLE "trace_events" (
    "event_id" UUID NOT NULL,
    "entity_type" "TraceEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "cycle_id" UUID,
    "lot_id" UUID,
    "event_type" "TraceEventType" NOT NULL,
    "actor_user_id" UUID,
    "actor_organization_id" UUID,
    "actor_role" VARCHAR(50) NOT NULL,
    "auth_proof_type" "AuthProofType" NOT NULL,
    "actor_auth_proof" TEXT NOT NULL,
    "event_time" TIMESTAMPTZ(3) NOT NULL,
    "server_recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_data" JSONB NOT NULL,
    "schema_version" VARCHAR(50) NOT NULL,
    "canonicalization_version" VARCHAR(50) NOT NULL,
    "data_hash" CHAR(64) NOT NULL,
    "previous_event_hash" CHAR(64),
    "supersedes_event_id" UUID,
    "causation_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "blockchain_proofs" (
    "proof_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "network" VARCHAR(100) NOT NULL,
    "tx_id" VARCHAR(255),
    "data_hash" CHAR(64) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3),
    "relayer_address" VARCHAR(255),
    "transaction_status" "BlockchainTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blockchain_proofs_pkey" PRIMARY KEY ("proof_id")
);

-- CreateTable
CREATE TABLE "quantity_movements" (
    "movement_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" "QuantityMovementType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "before_qty" DECIMAL(18,3) NOT NULL,
    "delta" DECIMAL(18,3) NOT NULL,
    "after_qty" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quantity_movements_pkey" PRIMARY KEY ("movement_id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "inspection_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "inspector_org_id" UUID,
    "result" "InspectionResult" NOT NULL,
    "note" TEXT,
    "inspected_at" TIMESTAMPTZ(3) NOT NULL,
    "evidence_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("inspection_id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "certificate_id" UUID NOT NULL,
    "lot_id" UUID,
    "cycle_id" UUID,
    "type" VARCHAR(100) NOT NULL,
    "issuer" VARCHAR(255) NOT NULL,
    "issue_date" DATE NOT NULL,
    "expiry_date" DATE,
    "document_ref" TEXT NOT NULL,
    "document_hash" CHAR(64) NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("certificate_id")
);

-- CreateTable
CREATE TABLE "trace_qr_codes" (
    "trace_qr_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "trace_token" VARCHAR(255) NOT NULL,
    "trace_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_qr_codes_pkey" PRIMARY KEY ("trace_qr_id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "idempotency_record_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "request_type" VARCHAR(50) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_id" UUID,
    "requester_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("idempotency_record_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "products_product_name_idx" ON "products"("product_name");

-- CreateIndex
CREATE INDEX "farms_organization_id_idx" ON "farms"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "plots_farm_id_name_key" ON "plots"("farm_id", "name");

-- CreateIndex
CREATE INDEX "production_cycles_product_id_idx" ON "production_cycles"("product_id");

-- CreateIndex
CREATE INDEX "production_cycles_plot_id_idx" ON "production_cycles"("plot_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_cycles_farm_id_cycle_code_key" ON "production_cycles"("farm_id", "cycle_code");

-- CreateIndex
CREATE INDEX "care_records_cycle_id_event_time_idx" ON "care_records"("cycle_id", "event_time");

-- CreateIndex
CREATE UNIQUE INDEX "iot_devices_device_code_key" ON "iot_devices"("device_code");

-- CreateIndex
CREATE INDEX "iot_devices_cycle_id_idx" ON "iot_devices"("cycle_id");

-- CreateIndex
CREATE INDEX "sensor_readings_cycle_id_timestamp_idx" ON "sensor_readings"("cycle_id", "timestamp");

-- CreateIndex
CREATE INDEX "sensor_readings_device_id_timestamp_idx" ON "sensor_readings"("device_id", "timestamp");

-- CreateIndex
CREATE INDEX "sensor_digests_cycle_id_period_start_period_end_idx" ON "sensor_digests"("cycle_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "harvest_events_final_sensor_digest_id_key" ON "harvest_events"("final_sensor_digest_id");

-- CreateIndex
CREATE INDEX "harvest_events_cycle_id_harvest_time_idx" ON "harvest_events"("cycle_id", "harvest_time");

-- CreateIndex
CREATE UNIQUE INDEX "lots_lot_code_key" ON "lots"("lot_code");

-- CreateIndex
CREATE UNIQUE INDEX "lots_harvest_id_key" ON "lots"("harvest_id");

-- CreateIndex
CREATE INDEX "lots_farm_org_id_current_state_idx" ON "lots"("farm_org_id", "current_state");

-- CreateIndex
CREATE INDEX "lots_product_id_idx" ON "lots"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_lot_id_key" ON "shipments"("lot_id");

-- CreateIndex
CREATE INDEX "shipments_transporter_org_id_status_idx" ON "shipments"("transporter_org_id", "status");

-- CreateIndex
CREATE INDEX "shipments_retailer_org_id_status_idx" ON "shipments"("retailer_org_id", "status");

-- CreateIndex
CREATE INDEX "trace_events_entity_type_entity_id_event_time_idx" ON "trace_events"("entity_type", "entity_id", "event_time");

-- CreateIndex
CREATE INDEX "trace_events_cycle_id_event_time_idx" ON "trace_events"("cycle_id", "event_time");

-- CreateIndex
CREATE INDEX "trace_events_lot_id_event_time_idx" ON "trace_events"("lot_id", "event_time");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_proofs_event_id_key" ON "blockchain_proofs"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_proofs_tx_id_key" ON "blockchain_proofs"("tx_id");

-- CreateIndex
CREATE INDEX "quantity_movements_lot_id_created_at_idx" ON "quantity_movements"("lot_id", "created_at");

-- CreateIndex
CREATE INDEX "quantity_movements_event_id_idx" ON "quantity_movements"("event_id");

-- CreateIndex
CREATE INDEX "inspections_lot_id_inspected_at_idx" ON "inspections"("lot_id", "inspected_at");

-- CreateIndex
CREATE INDEX "certificates_lot_id_idx" ON "certificates"("lot_id");

-- CreateIndex
CREATE INDEX "certificates_cycle_id_idx" ON "certificates"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "trace_qr_codes_lot_id_key" ON "trace_qr_codes"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "trace_qr_codes_trace_token_key" ON "trace_qr_codes"("trace_token");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_requester_id_operation_idempotency_key_key" ON "idempotency_records"("requester_id", "operation", "idempotency_key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("farm_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_cycles" ADD CONSTRAINT "production_cycles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_cycles" ADD CONSTRAINT "production_cycles_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("farm_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_cycles" ADD CONSTRAINT "production_cycles_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("plot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycles"("cycle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycles"("cycle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "iot_devices"("device_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycles"("cycle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_digests" ADD CONSTRAINT "sensor_digests_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycles"("cycle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_events" ADD CONSTRAINT "harvest_events_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycles"("cycle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_events" ADD CONSTRAINT "harvest_events_final_sensor_digest_id_fkey" FOREIGN KEY ("final_sensor_digest_id") REFERENCES "sensor_digests"("digest_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_harvest_id_fkey" FOREIGN KEY ("harvest_id") REFERENCES "harvest_events"("harvest_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_farm_org_id_fkey" FOREIGN KEY ("farm_org_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_parent_lot_id_fkey" FOREIGN KEY ("parent_lot_id") REFERENCES "lots"("lot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("lot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_transporter_org_id_fkey" FOREIGN KEY ("transporter_org_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_retailer_org_id_fkey" FOREIGN KEY ("retailer_org_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycles"("cycle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("lot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_actor_organization_id_fkey" FOREIGN KEY ("actor_organization_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_supersedes_event_id_fkey" FOREIGN KEY ("supersedes_event_id") REFERENCES "trace_events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_causation_event_id_fkey" FOREIGN KEY ("causation_event_id") REFERENCES "trace_events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "trace_events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quantity_movements" ADD CONSTRAINT "quantity_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("lot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quantity_movements" ADD CONSTRAINT "quantity_movements_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "trace_events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("lot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_org_id_fkey" FOREIGN KEY ("inspector_org_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("lot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycles"("cycle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_qr_codes" ADD CONSTRAINT "trace_qr_codes_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("lot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants that Prisma cannot express.
ALTER TABLE "plots" ADD CONSTRAINT "plots_area_non_negative" CHECK ("area" IS NULL OR "area" >= 0);
ALTER TABLE "care_records" ADD CONSTRAINT "care_quantity_positive" CHECK ("quantity" IS NULL OR "quantity" > 0);
ALTER TABLE "care_records" ADD CONSTRAINT "care_withdrawal_period_non_negative" CHECK ("withdrawal_period" IS NULL OR "withdrawal_period" >= 0);
ALTER TABLE "sensor_digests" ADD CONSTRAINT "sensor_digest_period_valid" CHECK ("period_end" >= "period_start");
ALTER TABLE "sensor_digests" ADD CONSTRAINT "sensor_digest_count_non_negative" CHECK ("reading_count" >= 0);
ALTER TABLE "sensor_digests" ADD CONSTRAINT "sensor_digest_hash_format" CHECK ("digest_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "harvest_events" ADD CONSTRAINT "harvest_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "lots" ADD CONSTRAINT "lot_quantities_valid" CHECK (
  "initial_quantity" > 0 AND
  "available_quantity" >= 0 AND
  "available_quantity" <= "initial_quantity"
);
ALTER TABLE "shipments" ADD CONSTRAINT "shipment_quantities_valid" CHECK (
  "shipped_quantity" > 0 AND
  ("received_quantity" IS NULL OR "received_quantity" >= 0) AND
  ("rejected_quantity" IS NULL OR "rejected_quantity" >= 0)
);
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_data_hash_format" CHECK ("data_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_previous_hash_format" CHECK (
  "previous_event_hash" IS NULL OR "previous_event_hash" ~ '^[0-9a-f]{64}$'
);
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_entity_context_present" CHECK (
  ("entity_type" IN ('PRODUCTION_CYCLE', 'CARE', 'SENSOR', 'HARVEST') AND "cycle_id" IS NOT NULL) OR
  ("entity_type" IN ('LOT', 'SHIPMENT', 'INSPECTION') AND "lot_id" IS NOT NULL) OR
  ("entity_type" = 'CERTIFICATE' AND ("cycle_id" IS NOT NULL OR "lot_id" IS NOT NULL))
);
ALTER TABLE "blockchain_proofs" ADD CONSTRAINT "proof_data_hash_format" CHECK ("data_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "blockchain_proofs" ADD CONSTRAINT "proof_transaction_state_valid" CHECK (
  ("transaction_status" = 'PENDING' AND "tx_id" IS NULL AND "recorded_at" IS NULL) OR
  ("transaction_status" = 'COMMITTED' AND "tx_id" IS NOT NULL AND "recorded_at" IS NOT NULL) OR
  ("transaction_status" = 'FAILED')
);
ALTER TABLE "quantity_movements" ADD CONSTRAINT "quantity_movement_values_valid" CHECK (
  "quantity" > 0 AND
  "before_qty" >= 0 AND
  "after_qty" >= 0 AND
  "after_qty" = "before_qty" + "delta" AND
  "quantity" = abs("delta")
);
ALTER TABLE "certificates" ADD CONSTRAINT "certificate_exactly_one_subject" CHECK (
  ("lot_id" IS NOT NULL AND "cycle_id" IS NULL) OR
  ("lot_id" IS NULL AND "cycle_id" IS NOT NULL)
);
ALTER TABLE "certificates" ADD CONSTRAINT "certificate_document_hash_format" CHECK ("document_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_request_hash_format" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

-- Trace history is append-only. Corrections must insert a new event that points to supersedes_event_id.
CREATE OR REPLACE FUNCTION reject_trace_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'trace_events is append-only; insert a correction event instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trace_events_no_update
BEFORE UPDATE ON "trace_events"
FOR EACH ROW EXECUTE FUNCTION reject_trace_event_mutation();

CREATE TRIGGER trace_events_no_delete
BEFORE DELETE ON "trace_events"
FOR EACH ROW EXECUTE FUNCTION reject_trace_event_mutation();

-- A proof must anchor exactly the hash produced for its TraceEvent.
CREATE OR REPLACE FUNCTION enforce_blockchain_proof_hash() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "trace_events"
    WHERE "event_id" = NEW."event_id" AND "data_hash" = NEW."data_hash"
  ) THEN
    RAISE EXCEPTION 'blockchain proof hash must match trace event hash';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER blockchain_proof_hash_matches_event
BEFORE INSERT OR UPDATE ON "blockchain_proofs"
FOR EACH ROW EXECUTE FUNCTION enforce_blockchain_proof_hash();

-- Cross-table ownership and one-to-one origin rules.
CREATE OR REPLACE FUNCTION enforce_farm_organization_type() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "organizations"
    WHERE "organization_id" = NEW."organization_id" AND "type" = 'FARM' AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'farm must belong to an active FARM organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER farms_require_farm_organization
BEFORE INSERT OR UPDATE OF "organization_id" ON "farms"
FOR EACH ROW EXECUTE FUNCTION enforce_farm_organization_type();

CREATE OR REPLACE FUNCTION enforce_harvest_digest_context() RETURNS trigger AS $$
BEGIN
  IF NEW."final_sensor_digest_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "sensor_digests"
    WHERE "digest_id" = NEW."final_sensor_digest_id"
      AND "cycle_id" = NEW."cycle_id"
      AND "is_final" = true
  ) THEN
    RAISE EXCEPTION 'harvest final sensor digest must be final and belong to the same production cycle';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER harvest_digest_matches_cycle
BEFORE INSERT OR UPDATE OF "cycle_id", "final_sensor_digest_id" ON "harvest_events"
FOR EACH ROW EXECUTE FUNCTION enforce_harvest_digest_context();

CREATE OR REPLACE FUNCTION enforce_lot_harvest_origin() RETURNS trigger AS $$
DECLARE
  expected_product UUID;
  expected_farm_org UUID;
  expected_quantity NUMERIC(18,3);
  expected_unit VARCHAR(50);
BEGIN
  SELECT pc."product_id", f."organization_id", h."quantity", h."unit"
    INTO expected_product, expected_farm_org, expected_quantity, expected_unit
  FROM "harvest_events" h
  JOIN "production_cycles" pc ON pc."cycle_id" = h."cycle_id"
  JOIN "farms" f ON f."farm_id" = pc."farm_id"
  WHERE h."harvest_id" = NEW."harvest_id";

  IF expected_product IS NULL OR
     NEW."product_id" <> expected_product OR
     NEW."farm_org_id" <> expected_farm_org OR
     NEW."initial_quantity" <> expected_quantity OR
     NEW."unit" <> expected_unit THEN
    RAISE EXCEPTION 'lot product, farm, quantity and unit must be derived from its harvest event';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lot_origin_matches_harvest
BEFORE INSERT OR UPDATE OF "harvest_id", "product_id", "farm_org_id", "initial_quantity", "unit" ON "lots"
FOR EACH ROW EXECUTE FUNCTION enforce_lot_harvest_origin();

CREATE OR REPLACE FUNCTION enforce_iot_device_binding() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "iot_devices"
    WHERE "device_id" = NEW."device_id"
      AND "cycle_id" = NEW."cycle_id"
      AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'sensor device must be active and bound to the same production cycle';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sensor_reading_requires_bound_device
BEFORE INSERT OR UPDATE OF "device_id", "cycle_id" ON "sensor_readings"
FOR EACH ROW EXECUTE FUNCTION enforce_iot_device_binding();

CREATE OR REPLACE FUNCTION enforce_core_shipment() RETURNS trigger AS $$
DECLARE
  expected_quantity NUMERIC(18,3);
  expected_unit VARCHAR(50);
  expected_state "LotState";
BEGIN
  SELECT "available_quantity", "unit", "current_state"
    INTO expected_quantity, expected_unit, expected_state
  FROM "lots" WHERE "lot_id" = NEW."lot_id";

  IF expected_state <> 'HARVESTED' OR
     NEW."shipped_quantity" <> expected_quantity OR
     NEW."unit" <> expected_unit THEN
    RAISE EXCEPTION 'core shipment requires a HARVESTED lot and must ship its full available quantity using the same unit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "organizations" WHERE "organization_id" = NEW."transporter_org_id" AND "type" = 'TRANSPORTER' AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'shipment transporter must be an active TRANSPORTER organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "organizations" WHERE "organization_id" = NEW."retailer_org_id" AND "type" = 'RETAILER' AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'shipment destination must be an active RETAILER organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shipment_core_rules
BEFORE INSERT OR UPDATE OF "lot_id", "transporter_org_id", "retailer_org_id", "shipped_quantity", "unit" ON "shipments"
FOR EACH ROW EXECUTE FUNCTION enforce_core_shipment();
