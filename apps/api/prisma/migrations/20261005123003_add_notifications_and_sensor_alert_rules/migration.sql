-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('LOT_EXPIRING', 'CERTIFICATE_EXPIRING', 'SENSOR_THRESHOLD_EXCEEDED', 'BLOCKCHAIN_PROCESSING_FAILED');

-- CreateEnum
CREATE TYPE "notification_severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('UNREAD', 'READ', 'RESOLVED');

-- DropIndex
DROP INDEX "uq_sensor_digest_window";

-- DropIndex
DROP INDEX "ux_sensor_digest_final_cycle";

-- AlterTable
ALTER TABLE "trace_event" ALTER COLUMN "schema_version" SET DEFAULT '2.0.0',
ALTER COLUMN "canonicalization_version" SET DEFAULT 'RFC8785';

-- CreateTable
CREATE TABLE "sensor_alert_rule" (
    "alert_rule_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "device_id" UUID,
    "sensor_type" VARCHAR(100) NOT NULL,
    "minimum_value" DECIMAL(16,6),
    "maximum_value" DECIMAL(16,6),
    "severity" "notification_severity" NOT NULL DEFAULT 'WARNING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_alert_rule_pkey" PRIMARY KEY ("alert_rule_id")
);

-- CreateTable
CREATE TABLE "notification" (
    "notification_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "recipient_user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "severity" "notification_severity" NOT NULL DEFAULT 'WARNING',
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "dedup_key" VARCHAR(255) NOT NULL,
    "metadata" JSONB,
    "status" "notification_status" NOT NULL DEFAULT 'UNREAD',
    "read_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("notification_id")
);

-- CreateIndex
CREATE INDEX "ix_sensor_alert_rule_org_enabled" ON "sensor_alert_rule"("organization_id", "enabled");

-- CreateIndex
CREATE INDEX "ix_sensor_alert_rule_device_type" ON "sensor_alert_rule"("device_id", "sensor_type");

-- CreateIndex
CREATE INDEX "ix_notification_org_status" ON "notification"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ix_notification_recipient_status" ON "notification"("recipient_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ix_notification_type_created" ON "notification"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_notification_recipient_dedup" ON "notification"("recipient_user_id", "dedup_key");

-- AddForeignKey
ALTER TABLE "sensor_alert_rule" ADD CONSTRAINT "sensor_alert_rule_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sensor_alert_rule" ADD CONSTRAINT "sensor_alert_rule_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "iot_device"("device_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sensor_alert_rule" ADD CONSTRAINT "sensor_alert_rule_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
