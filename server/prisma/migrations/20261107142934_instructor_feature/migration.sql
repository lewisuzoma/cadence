-- CreateEnum
CREATE TYPE "InstructorApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "InstructorProfileStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "InstructorApplicationAction" AS ENUM ('SUBMITTED', 'UPDATED', 'WITHDRAWN', 'APPROVED', 'REJECTED', 'NOTE_ADDED', 'SUSPENDED', 'REINSTATED');

-- CreateEnum
CREATE TYPE "CourseEventType" AS ENUM ('CREATED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'LESSONS_ADDED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('VIDEO', 'IMAGE');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPLICATION_SUBMITTED', 'APPLICATION_RECEIVED', 'APPLICATION_APPROVED', 'APPLICATION_REJECTED', 'APPLICATION_WITHDRAWN', 'INSTRUCTOR_SUSPENDED', 'INSTRUCTOR_REINSTATED', 'COURSE_PUBLISHED', 'COURSE_UNPUBLISHED', 'COURSE_ARCHIVED', 'COURSE_LESSONS_ADDED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'INSTRUCTOR';

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "learningObjectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "prerequisites" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shortDescription" VARCHAR(160) NOT NULL DEFAULT '',
ADD COLUMN     "targetAudience" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "thumbnailAssetId" UUID;

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "videoAssetId" UUID;

-- CreateTable
CREATE TABLE "instructor_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "professionalTitle" VARCHAR(120) NOT NULL,
    "expertise" TEXT[],
    "experience" TEXT NOT NULL,
    "biography" TEXT NOT NULL,
    "motivation" TEXT NOT NULL,
    "profilePhotoKey" VARCHAR(512),
    "portfolioUrl" VARCHAR(2048),
    "status" "InstructorApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instructor_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_application_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "applicationId" UUID,
    "userId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" "InstructorApplicationAction" NOT NULL,
    "fromStatus" "InstructorApplicationStatus",
    "toStatus" "InstructorApplicationStatus",
    "reason" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "bio" TEXT NOT NULL,
    "photoKey" VARCHAR(512),
    "status" "InstructorProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),
    "suspendedById" UUID,
    "suspensionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instructor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "courseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "type" "CourseEventType" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" INTEGER,
    "originalName" VARCHAR(255),
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "link" VARCHAR(512),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instructor_applications_status_createdAt_idx" ON "instructor_applications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "instructor_applications_userId_idx" ON "instructor_applications"("userId");

-- CreateIndex
CREATE INDEX "instructor_application_events_applicationId_createdAt_idx" ON "instructor_application_events"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "instructor_application_events_userId_createdAt_idx" ON "instructor_application_events"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_profiles_userId_key" ON "instructor_profiles"("userId");

-- CreateIndex
CREATE INDEX "instructor_profiles_status_idx" ON "instructor_profiles"("status");

-- CreateIndex
CREATE INDEX "course_events_courseId_createdAt_idx" ON "course_events"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "course_events_actorId_createdAt_idx" ON "course_events"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "media_assets_ownerId_kind_idx" ON "media_assets"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "media_assets_status_createdAt_idx" ON "media_assets"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "courses_createdById_status_idx" ON "courses"("createdById", "status");

-- CreateIndex
CREATE INDEX "enrollments_courseId_enrolledAt_idx" ON "enrollments"("courseId", "enrolledAt");

-- CreateIndex
CREATE INDEX "lesson_progress_lessonId_isCompleted_idx" ON "lesson_progress"("lessonId", "isCompleted");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_thumbnailAssetId_fkey" FOREIGN KEY ("thumbnailAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_applications" ADD CONSTRAINT "instructor_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_applications" ADD CONSTRAINT "instructor_applications_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_application_events" ADD CONSTRAINT "instructor_application_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "instructor_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_application_events" ADD CONSTRAINT "instructor_application_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_application_events" ADD CONSTRAINT "instructor_application_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_profiles" ADD CONSTRAINT "instructor_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_profiles" ADD CONSTRAINT "instructor_profiles_suspendedById_fkey" FOREIGN KEY ("suspendedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_events" ADD CONSTRAINT "course_events_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_events" ADD CONSTRAINT "course_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill and constraints that Prisma's schema language cannot express
-- ---------------------------------------------------------------------------

-- Course ownership.
--
-- No column is added or renamed: `courses.createdById` already records who
-- created each course, and that is exactly the ownership the instructor
-- feature needs.  Every existing course was created by an admin and stays
-- owned by that admin, who keeps `course:manage-any` regardless.  This
-- statement only asserts the invariant the services now rely on, so the
-- migration fails loudly here rather than leaving an unowned course to
-- surface as a 500 later.
DO $$
DECLARE orphans INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphans
  FROM "courses" c
  LEFT JOIN "users" u ON u."id" = c."createdById"
  WHERE u."id" IS NULL;

  IF orphans > 0 THEN
    RAISE EXCEPTION 'Cannot migrate: % course(s) have no owner', orphans;
  END IF;
END $$;

-- Give courses that predate the instructor feature a usable short
-- description, derived from the first sentence (or first 160 characters) of
-- the description they already have.
--
-- Without this, every already-published course would fail the new publish
-- checklist the first time its owner edited it, which would look like the
-- migration had broken the catalogue.
UPDATE "courses"
SET "shortDescription" = TRIM(
  SUBSTRING(
    CASE
      WHEN POSITION('. ' IN "description") BETWEEN 1 AND 158
        THEN LEFT("description", POSITION('. ' IN "description"))
      ELSE "description"
    END
    FROM 1 FOR 160
  )
)
WHERE "shortDescription" = '';

-- At most one active application per user.
--
-- Prisma cannot express a partial index, and a plain unique on (userId) would
-- be wrong: a rejected applicant is explicitly allowed to apply again, and
-- the old row is kept as history.  Enforcing it in the database as well as in
-- the service is what makes two simultaneous submissions safe — the service
-- check alone has a race between its read and its write.
CREATE UNIQUE INDEX "instructor_applications_one_pending_per_user"
  ON "instructor_applications" ("userId")
  WHERE "status" = 'PENDING';

-- Uploaded media must have a positive size, for the same reason lesson
-- durations must: the upload verifier divides by and compares against it.
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_size_positive" CHECK ("sizeBytes" > 0);

-- A READY asset without a duration would break completion tracking, which
-- divides by it.  Images legitimately have none.
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_ready_video_has_duration"
  CHECK (
    "kind" <> 'VIDEO' OR "status" <> 'READY'
    OR ("durationSeconds" IS NOT NULL AND "durationSeconds" > 0)
  );

-- A rejection must say why.  The service enforces it too; this stops any
-- other write path from recording a reasonless rejection the applicant would
-- see as an empty explanation.
ALTER TABLE "instructor_applications"
  ADD CONSTRAINT "instructor_applications_rejection_has_reason"
  CHECK ("status" <> 'REJECTED' OR ("decisionReason" IS NOT NULL AND LENGTH(TRIM("decisionReason")) > 0));

-- Likewise a suspension.
ALTER TABLE "instructor_profiles"
  ADD CONSTRAINT "instructor_profiles_suspension_has_reason"
  CHECK ("status" <> 'SUSPENDED' OR ("suspensionReason" IS NOT NULL AND LENGTH(TRIM("suspensionReason")) > 0));
