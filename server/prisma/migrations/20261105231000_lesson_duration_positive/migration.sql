-- The completion maths divides by a lesson's duration, so a zero or negative
-- value would make percentage and threshold calculations meaningless.
--
-- Zod rejects it at the API boundary and the service never writes one, but a
-- constraint is the only thing that holds for a direct SQL write, a future
-- import script or a bug in a new code path. Defence in depth, in the one
-- place that cannot be bypassed.
ALTER TABLE "lessons"
  ADD CONSTRAINT "lessons_duration_positive"
  CHECK ("durationSeconds" > 0);

-- Watched seconds and percentages are likewise bounded: progress is derived
-- from clamped input, so anything outside these ranges is a bug, not data.
ALTER TABLE "lesson_progress"
  ADD CONSTRAINT "lesson_progress_non_negative"
  CHECK ("lastPositionSeconds" >= 0 AND "maxWatchedSeconds" >= 0);

ALTER TABLE "lesson_progress"
  ADD CONSTRAINT "lesson_progress_percentage_range"
  CHECK ("completionPercentage" >= 0 AND "completionPercentage" <= 100);

-- A completed row must carry its completion timestamp, and an incomplete one
-- must not: the dashboards read `completedAt` directly.
ALTER TABLE "lesson_progress"
  ADD CONSTRAINT "lesson_progress_completed_at_consistent"
  CHECK (("isCompleted" = TRUE AND "completedAt" IS NOT NULL)
      OR ("isCompleted" = FALSE AND "completedAt" IS NULL));

-- Module and lesson positions start at 1. The reorder transaction parks rows
-- on negative orders mid-update, so this is deliberately not enforced for
-- lessons; modules have no such dance.
ALTER TABLE "modules"
  ADD CONSTRAINT "modules_order_positive"
  CHECK ("order" > 0);
