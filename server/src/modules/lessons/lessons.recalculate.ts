import type { Prisma } from '@prisma/client';
import { isCourseComplete } from '../progress/progress.calculator.js';
import { notificationsService } from '../notifications/notifications.service.js';

/**
 * Keeping enrollments honest when a course's lessons change.
 *
 * Course progress is derived — completed lessons ÷ total lessons — and it is
 * never stored. That is what stops it drifting, but it also means the
 * *enrollment* rows, which do store a status and a completion date, go stale
 * the moment the denominator moves. Two cases matter:
 *
 *  - **A lesson is deleted.** Its progress rows cascade away. Learners who
 *    had not finished it are suddenly closer to done, and some are now
 *    finished. Their enrollments must be promoted to COMPLETED.
 *  - **A lesson is added.** Learners who had finished the course no longer
 *    have. Their enrollments go back to ACTIVE, they are told why, and the
 *    fact that they once finished is preserved in `firstCompletedAt`.
 *
 * Both run inside the caller's transaction, so an enrollment is never left
 * describing a course shape that no longer exists.
 */

export type RecalculationResult = {
  /** Enrollments promoted to COMPLETED because the course shrank. */
  completed: string[];
  /** Enrollments reopened because the course grew. */
  reopened: string[];
};

/**
 * Recomputes every enrollment on a course against its current lessons.
 *
 * One grouped query, not one per learner: a course with a few hundred
 * learners must not turn a lesson deletion into a few hundred round trips.
 */
export async function recalculateCourseEnrollments(
  tx: Prisma.TransactionClient,
  courseId: string,
): Promise<RecalculationResult> {
  const totalLessons = await tx.lesson.count({ where: { courseId } });

  const enrollments = await tx.enrollment.findMany({
    where: { courseId, status: { not: 'CANCELLED' } },
    select: { id: true, userId: true, status: true, completedAt: true, firstCompletedAt: true },
  });
  if (enrollments.length === 0) return { completed: [], reopened: [] };

  // Completed-lesson counts for everyone on this course, grouped in the
  // database rather than counted per learner in JavaScript.
  const counts = await tx.lessonProgress.groupBy({
    by: ['userId'],
    where: { isCompleted: true, lesson: { courseId } },
    _count: { _all: true },
  });
  const doneBy = new Map(counts.map((row) => [row.userId, row._count._all]));

  const completed: string[] = [];
  const reopened: string[] = [];
  const now = new Date();

  for (const enrollment of enrollments) {
    const done = doneBy.get(enrollment.userId) ?? 0;
    const shouldBeComplete = isCourseComplete(done, totalLessons);

    if (shouldBeComplete && enrollment.status !== 'COMPLETED') {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          status: 'COMPLETED',
          completedAt: enrollment.completedAt ?? now,
          // Only ever set once; a second completion keeps the first date.
          firstCompletedAt: enrollment.firstCompletedAt ?? enrollment.completedAt ?? now,
        },
      });
      completed.push(enrollment.id);
      continue;
    }

    if (!shouldBeComplete && enrollment.status === 'COMPLETED') {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          status: 'ACTIVE',
          // Cleared, because they are not finished *now* — the dashboards
          // and the activity feed read this as "are they done?".
          completedAt: null,
          // Preserved, because they genuinely did finish once. This is the
          // history the spec asks to keep.
          firstCompletedAt: enrollment.firstCompletedAt ?? enrollment.completedAt ?? now,
        },
      });
      reopened.push(enrollment.id);
    }
  }

  return { completed, reopened };
}

/**
 * Tells learners whose finished course has reopened that there is new
 * material, in the same transaction as the change itself.
 */
export async function notifyReopenedLearners(
  tx: Prisma.TransactionClient,
  params: { courseId: string; courseTitle: string; courseSlug: string; addedLessons: number },
  reopenedEnrollmentIds: string[],
): Promise<void> {
  if (reopenedEnrollmentIds.length === 0) return;

  const rows = await tx.enrollment.findMany({
    where: { id: { in: reopenedEnrollmentIds } },
    select: { userId: true },
  });

  const lessonWord = params.addedLessons === 1 ? 'lesson' : 'lessons';
  await notificationsService.notify(
    rows.map((row) => ({
      userId: row.userId,
      type: 'COURSE_LESSONS_ADDED' as const,
      title: 'New lessons in a course you finished',
      body: `"${params.courseTitle}" added ${params.addedLessons} ${lessonWord}. Your course is open again.`,
      link: `/courses/${params.courseSlug}`,
    })),
    tx,
  );
}

/** Tells enrolled learners that a course they are taking has been archived. */
export async function notifyArchivedLearners(
  tx: Prisma.TransactionClient,
  params: { courseId: string; courseTitle: string; courseSlug: string },
): Promise<void> {
  const rows = await tx.enrollment.findMany({
    where: { courseId: params.courseId, status: { not: 'CANCELLED' } },
    select: { userId: true },
  });
  if (rows.length === 0) return;

  await notificationsService.notify(
    rows.map((row) => ({
      userId: row.userId,
      type: 'COURSE_ARCHIVED' as const,
      title: 'A course you are taking was archived',
      body: `"${params.courseTitle}" is no longer in the catalog. You keep full access and your progress is unchanged.`,
      link: `/courses/${params.courseSlug}`,
    })),
    tx,
  );
}
