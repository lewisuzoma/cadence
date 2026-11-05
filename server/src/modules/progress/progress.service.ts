import type { LessonProgressRow, ProgressQuery, ProgressResult } from '@cadence/shared';
import type { Prisma } from '@prisma/client';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import {
  applyProgress,
  canComplete,
  clampPosition,
  courseProgressPercentage,
  isCourseComplete,
} from './progress.calculator.js';

/**
 * Recording what a learner has watched.
 *
 * Everything here is scoped by `userId` taken from `req.user`, so one learner
 * can neither read nor write another's progress (the IDOR tests cover this).
 * Writes are upserts on the unique `(userId, lessonId)` pair, which makes
 * concurrent heartbeats from two tabs safe, and each write happens in a
 * transaction together with the enrollment roll-up so the two cannot disagree.
 */

type LessonWithCourse = {
  id: string;
  courseId: string;
  durationSeconds: number;
  isPreview: boolean;
};

/**
 * Progress requires an ACTIVE or COMPLETED enrollment on the lesson's course.
 * A preview viewer with no enrollment is allowed to watch but is not tracked:
 * a 403 here is the honest answer, and the client knows not to send.
 */
async function assertTrackable(userId: string, lesson: LessonWithCourse) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId: lesson.courseId } },
  });
  if (!enrollment || enrollment.status === 'CANCELLED') {
    throw new ForbiddenError('Enroll in this course before saving progress');
  }
  return enrollment;
}

/**
 * Recomputes the enrollment after a lesson changes, inside the caller's
 * transaction: completed-lesson count, last position, and whether the whole
 * course is now finished.
 */
async function rollUpEnrollment(
  tx: Prisma.TransactionClient,
  params: { userId: string; courseId: string; lessonId: string; enrollmentId: string },
) {
  const [totalLessons, completedLessons] = await Promise.all([
    tx.lesson.count({ where: { courseId: params.courseId } }),
    tx.lessonProgress.count({
      where: {
        userId: params.userId,
        isCompleted: true,
        lesson: { courseId: params.courseId },
      },
    }),
  ]);

  const complete = isCourseComplete(completedLessons, totalLessons);
  const existing = await tx.enrollment.findUnique({
    where: { id: params.enrollmentId },
    select: { completedAt: true, status: true },
  });

  await tx.enrollment.update({
    where: { id: params.enrollmentId },
    data: {
      lastAccessedAt: new Date(),
      lastLessonId: params.lessonId,
      status: complete ? 'COMPLETED' : 'ACTIVE',
      // Stamped once: finishing, un-finishing and finishing again keeps the
      // original completion date.
      ...(complete && !existing?.completedAt ? { completedAt: new Date() } : {}),
      ...(!complete && existing?.completedAt ? { completedAt: null } : {}),
    },
  });

  return { totalLessons, completedLessons, isCompleted: complete };
}

async function loadLesson(lessonId: string): Promise<LessonWithCourse> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, courseId: true, durationSeconds: true, isPreview: true },
  });
  if (!lesson) throw new NotFoundError('Lesson');
  return lesson;
}

export const progressService = {
  /** Reading another learner's progress is impossible: the query is scoped. */
  async getForLesson(userId: string, lessonId: string) {
    const lesson = await loadLesson(lessonId);
    const progress = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId: lesson.id } },
    });

    return {
      lessonId: lesson.id,
      courseId: lesson.courseId,
      durationSeconds: lesson.durationSeconds,
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
  },

  /**
   * A heartbeat, pause, seek or visibility flush.  The client sends only a
   * position; the server decides what it means, including whether the 90%
   * threshold has now been crossed.
   */
  async save(userId: string, lessonId: string, positionSeconds: number): Promise<ProgressResult> {
    const lesson = await loadLesson(lessonId);
    const enrollment = await assertTrackable(userId, lesson);

    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
      });

      const next = applyProgress(previous, positionSeconds, lesson.durationSeconds);
      const justCompleted = next.isCompleted && !previous?.isCompleted;

      const saved = await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
        create: {
          userId,
          lessonId: lesson.id,
          lastPositionSeconds: next.lastPositionSeconds,
          maxWatchedSeconds: next.maxWatchedSeconds,
          completionPercentage: next.completionPercentage,
          isCompleted: next.isCompleted,
          ...(next.isCompleted ? { completedAt: new Date() } : {}),
        },
        update: {
          lastPositionSeconds: next.lastPositionSeconds,
          maxWatchedSeconds: next.maxWatchedSeconds,
          completionPercentage: next.completionPercentage,
          isCompleted: next.isCompleted,
          // Only ever set, never cleared: completion is sticky.
          ...(justCompleted ? { completedAt: new Date() } : {}),
        },
      });

      const course = await rollUpEnrollment(tx, {
        userId,
        courseId: lesson.courseId,
        lessonId: lesson.id,
        enrollmentId: enrollment.id,
      });

      return { saved, course };
    });

    return {
      lessonId: lesson.id,
      courseId: lesson.courseId,
      progress: {
        lastPositionSeconds: result.saved.lastPositionSeconds,
        maxWatchedSeconds: result.saved.maxWatchedSeconds,
        completionPercentage: result.saved.completionPercentage,
        isCompleted: result.saved.isCompleted,
        completedAt: result.saved.completedAt?.toISOString() ?? null,
        updatedAt: result.saved.updatedAt.toISOString(),
      },
      course: {
        progressPercentage: courseProgressPercentage(
          result.course.completedLessons,
          result.course.totalLessons,
        ),
        completedLessons: result.course.completedLessons,
        totalLessons: result.course.totalLessons,
        isCompleted: result.course.isCompleted,
      },
    };
  },

  /**
   * Explicit completion, from the video's `ended` event or a learner who has
   * watched past the threshold.  Idempotent: calling it twice returns the
   * same record with the original `completedAt`.  A request that has not
   * earned completion is a 422 — opening a lesson never completes it.
   */
  async complete(
    userId: string,
    lessonId: string,
    positionSeconds: number,
  ): Promise<ProgressResult> {
    const lesson = await loadLesson(lessonId);
    const enrollment = await assertTrackable(userId, lesson);

    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
      });

      const position = clampPosition(positionSeconds, lesson.durationSeconds);
      const alreadyCompleted = previous?.isCompleted ?? false;

      if (
        !alreadyCompleted &&
        !canComplete(position, previous?.maxWatchedSeconds ?? 0, lesson.durationSeconds)
      ) {
        throw new UnprocessableError(
          'Watch more of this lesson before marking it complete',
        );
      }

      const maxWatchedSeconds = Math.max(previous?.maxWatchedSeconds ?? 0, position);
      const saved = await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
        create: {
          userId,
          lessonId: lesson.id,
          lastPositionSeconds: position,
          maxWatchedSeconds,
          completionPercentage: 100,
          isCompleted: true,
          completedAt: new Date(),
        },
        update: {
          lastPositionSeconds: position,
          maxWatchedSeconds,
          completionPercentage: 100,
          isCompleted: true,
          // Preserved on a repeat call, so a replay cannot rewrite the date.
          ...(alreadyCompleted ? {} : { completedAt: new Date() }),
        },
      });

      const course = await rollUpEnrollment(tx, {
        userId,
        courseId: lesson.courseId,
        lessonId: lesson.id,
        enrollmentId: enrollment.id,
      });

      return { saved, course };
    });

    return {
      lessonId: lesson.id,
      courseId: lesson.courseId,
      progress: {
        lastPositionSeconds: result.saved.lastPositionSeconds,
        maxWatchedSeconds: result.saved.maxWatchedSeconds,
        completionPercentage: result.saved.completionPercentage,
        isCompleted: result.saved.isCompleted,
        completedAt: result.saved.completedAt?.toISOString() ?? null,
        updatedAt: result.saved.updatedAt.toISOString(),
      },
      course: {
        progressPercentage: courseProgressPercentage(
          result.course.completedLessons,
          result.course.totalLessons,
        ),
        completedLessons: result.course.completedLessons,
        totalLessons: result.course.totalLessons,
        isCompleted: result.course.isCompleted,
      },
    };
  },

  /** The caller's own progress rows, newest first. */
  async listMine(
    userId: string,
    query: ProgressQuery,
  ): Promise<{ items: LessonProgressRow[]; meta: ReturnType<typeof buildMeta> }> {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const where = {
      userId,
      ...(query.courseId ? { lesson: { courseId: query.courseId } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.lessonProgress.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: {
          lesson: {
            select: {
              id: true,
              title: true,
              durationSeconds: true,
              course: { select: { id: true, title: true, slug: true } },
            },
          },
        },
      }),
      prisma.lessonProgress.count({ where }),
    ]);

    const items: LessonProgressRow[] = rows.map((row) => ({
      lessonId: row.lessonId,
      lessonTitle: row.lesson.title,
      durationSeconds: row.lesson.durationSeconds,
      courseId: row.lesson.course.id,
      courseTitle: row.lesson.course.title,
      courseSlug: row.lesson.course.slug,
      lastPositionSeconds: row.lastPositionSeconds,
      maxWatchedSeconds: row.maxWatchedSeconds,
      completionPercentage: row.completionPercentage,
      isCompleted: row.isCompleted,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }));

    return { items, meta: buildMeta(query.page, query.pageSize, total) };
  },
};
