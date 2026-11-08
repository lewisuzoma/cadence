-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "fingerprint" VARCHAR(255),
ADD COLUMN     "partSizeBytes" INTEGER,
ADD COLUMN     "uploadId" VARCHAR(512);

-- CreateIndex
CREATE INDEX "media_assets_ownerId_fingerprint_status_idx" ON "media_assets"("ownerId", "fingerprint", "status");
