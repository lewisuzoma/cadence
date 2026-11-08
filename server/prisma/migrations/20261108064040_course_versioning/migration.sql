-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "liveVersionId" UUID;

-- CreateTable
CREATE TABLE "course_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "courseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "shortDescription" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "thumbnailUrl" VARCHAR(2048) NOT NULL,
    "learningObjectives" TEXT[],
    "prerequisites" TEXT[],
    "targetAudience" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID NOT NULL,
    "changeSummary" TEXT,

    CONSTRAINT "course_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_version_lessons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "versionId" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "moduleTitle" VARCHAR(140) NOT NULL,
    "moduleOrder" INTEGER NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "description" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "isPreview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "course_version_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_versions_courseId_publishedAt_idx" ON "course_versions"("courseId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "course_versions_courseId_version_key" ON "course_versions"("courseId", "version");

-- CreateIndex
CREATE INDEX "course_version_lessons_lessonId_idx" ON "course_version_lessons"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "course_version_lessons_versionId_lessonId_key" ON "course_version_lessons"("versionId", "lessonId");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_liveVersionId_fkey" FOREIGN KEY ("liveVersionId") REFERENCES "course_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_version_lessons" ADD CONSTRAINT "course_version_lessons_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "course_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_version_lessons" ADD CONSTRAINT "course_version_lessons_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: give every already-published course a version 1
-- ---------------------------------------------------------------------------
--
-- Learner-facing reads come from the live version once this ships. A
-- published course without one would therefore vanish from the catalogue
-- the moment the code deployed, taking its enrolled learners' access with
-- it — so every published course is snapshotted exactly as it stands.
--
-- Drafts are deliberately skipped: they have never been published, and
-- inventing a version for them would make "has unpublished changes" false
-- for a course that has never been seen by anyone.

INSERT INTO "course_versions" (
  "id", "courseId", "version", "title", "shortDescription", "description",
  "category", "difficulty", "thumbnailUrl", "learningObjectives",
  "prerequisites", "targetAudience", "publishedAt", "publishedById",
  "changeSummary"
)
SELECT
  gen_random_uuid(),
  c."id",
  1,
  c."title",
  c."shortDescription",
  c."description",
  c."category",
  c."difficulty",
  c."thumbnailUrl",
  c."learningObjectives",
  c."prerequisites",
  c."targetAudience",
  COALESCE(c."publishedAt", c."createdAt"),
  c."createdById",
  'Imported when course versioning was introduced.'
FROM "courses" c
WHERE c."status" = 'PUBLISHED';

-- The lessons as they stand become that version's curriculum.
INSERT INTO "course_version_lessons" (
  "id", "versionId", "lessonId", "moduleTitle", "moduleOrder",
  "title", "description", "durationSeconds", "order", "isPreview"
)
SELECT
  gen_random_uuid(),
  v."id",
  l."id",
  m."title",
  m."order",
  l."title",
  l."description",
  l."durationSeconds",
  l."order",
  l."isPreview"
FROM "course_versions" v
JOIN "lessons" l ON l."courseId" = v."courseId"
JOIN "modules" m ON m."id" = l."moduleId";

-- Point each published course at the version just created for it.
UPDATE "courses" c
SET "liveVersionId" = v."id"
FROM "course_versions" v
WHERE v."courseId" = c."id" AND v."version" = 1 AND c."status" = 'PUBLISHED';

-- An archived course keeps whatever it was last published as, so learners
-- who are still enrolled keep seeing the curriculum they signed up to.
-- Archived courses that were never published simply have no version, and
-- are unreachable anyway.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "courses" WHERE "status" = 'PUBLISHED' AND "liveVersionId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Backfill incomplete: a published course has no live version';
  END IF;
END $$;
