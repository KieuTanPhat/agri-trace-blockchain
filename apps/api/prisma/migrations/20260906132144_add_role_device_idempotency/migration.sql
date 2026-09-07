/*
  Warnings:

  - The `current_state` column on the `batches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `organizations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `status` on the `shipments` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `users` table. All the data in the column will be lost.
  - The `account_status` column on the `users` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `type` on the `organizations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `device_id` on the `sensor_readings` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `role_id` to the `users` table without a default value. This is not possible if the table is not empty.
  - Made the column `organization_id` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('FARM', 'COOPERATIVE', 'TRANSPORTER', 'RETAILER');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "BatchState" AS ENUM ('CREATED', 'PLANTED', 'HARVESTED', 'IN_TRANSPORT', 'TRANSPORTED', 'RETAIL_RECEIVED', 'FOR_SALE', 'CANCELLED', 'DAMAGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('TEMPERATURE', 'HUMIDITY', 'TEMPERATURE_HUMIDITY', 'SOIL_MOISTURE');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "batches" DROP COLUMN "current_state",
ADD COLUMN     "current_state" "BatchState" NOT NULL DEFAULT 'CREATED';

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "type",
ADD COLUMN     "type" "OrganizationType" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "sensor_readings" DROP COLUMN "device_id",
ADD COLUMN     "device_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "shipments" DROP COLUMN "status";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "role",
ADD COLUMN     "role_id" UUID NOT NULL,
ALTER COLUMN "organization_id" SET NOT NULL,
DROP COLUMN "account_status",
ADD COLUMN     "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "roles" (
    "role_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "devices" (
    "device_id" UUID NOT NULL,
    "device_code" VARCHAR(100) NOT NULL,
    "organization_id" UUID NOT NULL,
    "batch_id" UUID,
    "name" VARCHAR(255),
    "type" "DeviceType" NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "idempotency_record_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "requester_type" VARCHAR(50) NOT NULL,
    "requester_id" VARCHAR(255) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("idempotency_record_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_code_key" ON "devices"("device_code");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_idempotency_key_operation_requester_typ_key" ON "idempotency_records"("idempotency_key", "operation", "requester_type", "requester_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE RESTRICT ON UPDATE CASCADE;
