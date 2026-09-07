-- CreateTable
CREATE TABLE "organizations" (
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255),
    "organization_id" UUID,
    "role" VARCHAR(50) NOT NULL DEFAULT 'USER',
    "account_status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "batches" (
    "batch_id" UUID NOT NULL,
    "farm_org_id" UUID NOT NULL,
    "batch_code" VARCHAR(100) NOT NULL,
    "product_name" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_state" VARCHAR(50) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("batch_id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "shipment_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "transporter_org_id" UUID NOT NULL,
    "retailer_org_id" UUID NOT NULL,
    "origin" VARCHAR(255) NOT NULL,
    "destination" VARCHAR(255) NOT NULL,
    "pickup_time" TIMESTAMPTZ(3),
    "delivery_time" TIMESTAMPTZ(3),
    "status" VARCHAR(50) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("shipment_id")
);

-- CreateTable
CREATE TABLE "trace_events" (
    "event_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "actor_context" JSONB NOT NULL,
    "event_time" TIMESTAMPTZ(3) NOT NULL,
    "business_data" JSONB NOT NULL,
    "schema_version" VARCHAR(50) NOT NULL,
    "data_hash" VARCHAR(64) NOT NULL,

    CONSTRAINT "trace_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "blockchain_proofs" (
    "transaction_id" VARCHAR(255) NOT NULL,
    "event_id" UUID NOT NULL,
    "network" VARCHAR(100) NOT NULL,
    "data_hash" VARCHAR(64) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "relayer_address" VARCHAR(255) NOT NULL,

    CONSTRAINT "blockchain_proofs_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "sensor_readings" (
    "reading_id" UUID NOT NULL,
    "device_id" VARCHAR(100) NOT NULL,
    "batch_id" UUID NOT NULL,
    "temperature" DECIMAL(5,2) NOT NULL,
    "humidity" DECIMAL(5,2) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "ingest_time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_readings_pkey" PRIMARY KEY ("reading_id")
);

-- CreateTable
CREATE TABLE "sensor_digests" (
    "digest_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "reading_count" INTEGER NOT NULL,
    "digest_hash" VARCHAR(64) NOT NULL,
    "is_final" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sensor_digests_pkey" PRIMARY KEY ("digest_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "batches_batch_code_key" ON "batches"("batch_code");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_batch_id_key" ON "shipments"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_proofs_event_id_key" ON "blockchain_proofs"("event_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_farm_org_id_fkey" FOREIGN KEY ("farm_org_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_transporter_org_id_fkey" FOREIGN KEY ("transporter_org_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_retailer_org_id_fkey" FOREIGN KEY ("retailer_org_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "trace_events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_digests" ADD CONSTRAINT "sensor_digests_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
