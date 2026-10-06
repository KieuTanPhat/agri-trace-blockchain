CREATE TYPE "media_kind" AS ENUM ('PRODUCT_IMAGE', 'LOT_IMAGE', 'EVIDENCE_DOCUMENT');
CREATE TYPE "media_visibility" AS ENUM ('PRIVATE', 'PUBLIC');

CREATE TABLE "media_asset" (
    "media_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID,
    "lot_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "kind" "media_kind" NOT NULL,
    "visibility" "media_visibility" NOT NULL DEFAULT 'PRIVATE',
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "storage_key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("media_id"),
    CONSTRAINT "ck_media_asset_one_parent" CHECK (("product_id" IS NOT NULL) <> ("lot_id" IS NOT NULL)),
    CONSTRAINT "ck_media_asset_kind_parent" CHECK (
      ("kind" = 'PRODUCT_IMAGE' AND "product_id" IS NOT NULL) OR
      ("kind" IN ('LOT_IMAGE', 'EVIDENCE_DOCUMENT') AND "lot_id" IS NOT NULL)
    ),
    CONSTRAINT "ck_media_asset_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 8388608),
    CONSTRAINT "ck_media_asset_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "media_asset_storage_key_key" ON "media_asset"("storage_key");
CREATE INDEX "ix_media_product_visibility" ON "media_asset"("product_id", "visibility", "created_at");
CREATE INDEX "ix_media_lot_visibility" ON "media_asset"("lot_id", "visibility", "created_at");

ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
