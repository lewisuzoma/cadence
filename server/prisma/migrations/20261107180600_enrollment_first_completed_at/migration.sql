-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "firstCompletedAt" TIMESTAMP(3);

-- Backfill: anyone currently marked complete did, in fact, first complete
-- it then. Without this, every existing completion would look as though it
-- had never happened the moment the column started being read.
UPDATE "enrollments"
SET "firstCompletedAt" = "completedAt"
WHERE "completedAt" IS NOT NULL AND "firstCompletedAt" IS NULL;
