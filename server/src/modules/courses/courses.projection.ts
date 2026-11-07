import type {
  CourseEnrollmentState,
  CourseSummary,
  LessonStatus,
  LessonSummary,
  PublicInstructor,
} from '@cadence/shared';
import type { Enrollment, LessonProgress } from '@prisma/client';
import { courseProgressPercentage } from '../progress/progress.calculator.js';
import type { CourseListRow } from './courses.repository.js';

/**
 * Turns database rows into the API's response shapes.
 *
 * Every derived number a client sees is computed here or in the progress
 * calculator — never in the browser — so the server stays the single source
 * of truth for progress, duration and lesson counts.
 */

export type LessonRowForProjection = {
  id: string;
  moduleId: string;
  courseId: string;
  title: string;
  description: string;
  durationSeconds: number;
  order: number;
  isPreview: boolean;
  /** Present on authoring reads; absent on the learner-facing ones. */
  videoUrl?: string;
  videoAssetId?: string | null;
  videoAsset?: { status: string } | null;
};

/**
 * Which of the two video sources a lesson uses.
 *
 * An upload only counts once it is READY: a half-verified asset is not a
 * video the authoring UI should report as present, and the publish
 * checklist takes the same view.
 */
export function videoKindFor(lesson: LessonRowForProjection): 'UPLOAD' | 'URL' | 'NONE' {
  if (lesson.videoAsset) {
    return lesson.videoAsset.status === 'READY' ? 'UPLOAD' : 'NONE';
  }
  if (lesson.videoAssetId) return 'NONE';
  return lesson.videoUrl && /^https:\/\//.test(lesson.videoUrl) ? 'URL' : 'NONE';
}

export function buildEnrollmentState(
  enrollment: Enrollment | undefined,
  completedLessons: number,
  totalLessons: number,
): CourseEnrollmentState | null {
  if (!enrollment) return null;
  return {
    isEnrolled: true,
    status: enrollment.status,
    progressPercentage: courseProgressPercentage(completedLessons, totalLessons),
    completedLessons,
    lastLessonId: enrollment.lastLessonId,
    enrolledAt: enrollment.enrolledAt.toISOString(),
    completedAt: enrollment.completedAt?.toISOString() ?? null,
  };
}

/**
 * The instructor as the catalog shows them.
 *
 * Built from the profile row and nothing else, so no amount of careless
 * `select` widening upstream can leak an instructor's email, role or account
 * state into a public response.
 */
export function buildPublicInstructor(
  profile:
    | { displayName: string; title: string; photoKey: string | null }
    | null
    | undefined,
  photoUrl?: string | null,
): PublicInstructor | null {
  if (!profile) return null;
  return {
    displayName: profile.displayName,
    title: profile.title,
    photoUrl: photoUrl ?? null,
  };
}

export function buildCourseSummary(params: {
  course: CourseListRow;
  lessonCount: number;
  totalDuration: number;
  enrollment?: Enrollment | undefined;
  completedLessons?: number;
  instructor?: PublicInstructor | null;
}): CourseSummary {
  const { course, lessonCount, totalDuration } = params;
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    shortDescription: course.shortDescription,
    category: course.category,
    thumbnailUrl: course.thumbnailUrl,
    difficulty: course.difficulty,
    status: course.status,
    lessonCount,
    estimatedDuration: totalDuration,
    publishedAt: course.publishedAt?.toISOString() ?? null,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
    enrollment: buildEnrollmentState(
      params.enrollment,
      params.completedLessons ?? 0,
      lessonCount,
    ),
    instructor: params.instructor ?? null,
  };
}

/**
 * A lesson's display status.
 *
 * LOCKED means "visible in the list but not playable by this caller": a
 * non-preview lesson in a course the learner has not enrolled in. It is a
 * display hint only — the server independently refuses to serve the video URL
 * or record progress, so a client that ignores it gains nothing.
 */
export function lessonStatus(
  progress: LessonProgress | undefined,
  options: { canView: boolean; isPreview: boolean },
): LessonStatus {
  if (!options.canView && !options.isPreview) return 'LOCKED';
  if (!progress) return 'NOT_STARTED';
  if (progress.isCompleted) return 'COMPLETED';
  return progress.maxWatchedSeconds > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
}

export function buildLessonSummary(
  lesson: LessonRowForProjection,
  progress: LessonProgress | undefined,
  options: { canView: boolean },
): LessonSummary {
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    courseId: lesson.courseId,
    title: lesson.title,
    description: lesson.description,
    durationSeconds: lesson.durationSeconds,
    order: lesson.order,
    isPreview: lesson.isPreview,
    videoKind: videoKindFor(lesson),
    status: lessonStatus(progress, { canView: options.canView, isPreview: lesson.isPreview }),
    progress: progress
      ? {
          lastPositionSeconds: progress.lastPositionSeconds,
          maxWatchedSeconds: progress.maxWatchedSeconds,
          completionPercentage: progress.completionPercentage,
          isCompleted: progress.isCompleted,
          completedAt: progress.completedAt?.toISOString() ?? null,
          updatedAt: progress.updatedAt.toISOString(),
        }
      : null,
  };
}

/** Index helpers, so callers avoid nested loops over the same rows. */
export function indexBy<T, K extends string>(rows: T[], key: (row: T) => K): Map<K, T> {
  const map = new Map<K, T>();
  for (const row of rows) map.set(key(row), row);
  return map;
}
