import type {
  CourseAnalytics,
  CourseLearnerQuery,
  CourseLearnerRow,
  LearnerCourseProgress,
  ProgressBand,
} from '@cadence/shared';
import { env } from '../../config/env.js';
import { NotFoundError } from '../../lib/errors.js';
import { assertOwnsCourse } from '../../lib/ownership.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthUser } from '../../middlewares/types.js';
import { analyticsRepository } from './analytics.repository.js';

/**
 * Course analytics and learner monitoring.
 *
 * **The metric definitions live here and nowhere else.** They are stated
 * once, used by the stat cards, the four charts, the learners table and
 * its filters alike, and documented in ARCHITECTURE.md with the same
 * wording. The alternative — each screen computing its own — is how a
 * dashboard ends up showing two different "completion rates" for the same
 * course and nobody can say which is right.
 *
 *   Enrolled        Enrollments on the course that are not CANCELLED,
 *                   excluding the owner and any admin. (An owner cannot
 *                   enroll at all; an admin might have, and counting
 *                   staff as learners would skew every other figure.)
 *   Active learner  Any progress or enrollment activity in the last
 *                   ANALYTICS_ACTIVE_DAYS days (default 14).
 *   Completed       Enrollment status COMPLETED.
 *   Completion rate Completed learners ÷ enrolled learners.
 *   Average progress Mean of the per-learner course progress, which is
 *                   itself completed lessons ÷ total lessons — the same
 *                   figure the learner sees, so the two never disagree.
 *
 * Every one of them is computed with SQL aggregates. Nothing loops over
 * learner rows in JavaScript.
 */

/** Privacy: what an instructor may learn about a learner, and no more. */
const LEARNER_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

function bandFor(percentage: number): ProgressBand {
  if (percentage >= 100) return '100';
  if (percentage >= 75) return '75-99';
  if (percentage >= 50) return '50-75';
  if (percentage >= 25) return '25-50';
  return '0-25';
}

/** The row's display status, as the artifact's table shows it. */
function displayStatus(params: {
  enrollmentStatus: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  percentage: number;
  lastActivityAt: Date | null;
  activeCutoff: Date;
}): CourseLearnerRow['displayStatus'] {
  if (params.enrollmentStatus === 'COMPLETED') return 'COMPLETED';
  if (params.percentage === 0 && !params.lastActivityAt) return 'NOT_STARTED';
  if (!params.lastActivityAt || params.lastActivityAt < params.activeCutoff) {
    return 'INACTIVE';
  }
  return 'IN_PROGRESS';
}

function activeCutoff(): Date {
  return new Date(Date.now() - env.ANALYTICS_ACTIVE_DAYS * 24 * 60 * 60 * 1000);
}

export const analyticsService = {
  /**
   * Narrows a course to one the actor may see analytics for.
   *
   * Shared by all three endpoints so there is exactly one ownership check,
   * and another instructor's course is a 404 here as everywhere else.
   */
  async loadCourse(courseId: string, actor: AuthUser) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        createdById: true,
      },
    });
    assertOwnsCourse(course, actor);
    return course;
  },

  /** Everything the Course analytics screen renders. */
  async courseAnalytics(courseId: string, actor: AuthUser): Promise<CourseAnalytics> {
    const course = await this.loadCourse(courseId, actor);
    const cutoff = activeCutoff();

    const [totals, lessonCount, series, distribution, perLesson] = await Promise.all([
      analyticsRepository.courseTotals(courseId, course.createdById, cutoff),
      prisma.lesson.count({ where: { courseId } }),
      analyticsRepository.enrollmentsByWeek(courseId, course.createdById),
      analyticsRepository.progressDistribution(courseId, course.createdById),
      analyticsRepository.lessonCompletion(courseId, course.createdById),
    ]);

    const enrolled = totals.enrolled;
    const distributionTotal = distribution.reduce((sum, row) => sum + row.count, 0);

    return {
      courseId,
      courseTitle: course.title,
      courseStatus: course.status,
      lessonCount,
      stats: {
        enrolled,
        active: totals.active,
        inactive: Math.max(0, enrolled - totals.active),
        completed: totals.completed,
        // A course with nobody on it is 0%, not a division by zero.
        completionRate: enrolled === 0 ? 0 : Math.round((totals.completed / enrolled) * 100),
        averageProgress: totals.averageProgress,
        lessonsCompleted: totals.lessonsCompleted,
        firstEnrollmentAt: totals.firstEnrollmentAt?.toISOString() ?? null,
      },
      enrollmentsOverTime: series.map((row) => ({
        weekStart: row.weekStart.toISOString(),
        count: row.count,
      })),
      progressDistribution: distribution.map((row) => ({
        band: row.band,
        count: row.count,
        percentage:
          distributionTotal === 0 ? 0 : Math.round((row.count / distributionTotal) * 100),
      })),
      lessonCompletion: perLesson.map((row) => ({
        lessonId: row.lessonId,
        order: row.order,
        title: row.title,
        completed: row.completed,
        percentage: enrolled === 0 ? 0 : Math.round((row.completed / enrolled) * 100),
      })),
      activeDays: env.ANALYTICS_ACTIVE_DAYS,
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * The enrolled-learners table: search, filters, sorting and pagination,
   * all server-side.
   *
   * Paging in the database rather than fetching every learner and slicing
   * in JavaScript is what keeps a course with thousands of learners from
   * being a memory problem, and it is why the filters have to be
   * expressible in SQL rather than applied afterwards.
   */
  async courseLearners(courseId: string, query: CourseLearnerQuery, actor: AuthUser) {
    const course = await this.loadCourse(courseId, actor);
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const cutoff = activeCutoff();

    const { rows, total } = await analyticsRepository.learnerPage({
      courseId,
      ownerId: course.createdById,
      search: query.search,
      status: query.status,
      band: query.band,
      sort: query.sort,
      direction: query.direction,
      cutoff,
      skip,
      take,
    });

    const items: CourseLearnerRow[] = rows.map((row) => ({
      userId: row.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      enrolledAt: row.enrolledAt.toISOString(),
      progressPercentage: row.percentage,
      completedLessons: row.completedLessons,
      totalLessons: row.totalLessons,
      lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
      enrollmentStatus: row.enrollmentStatus,
      displayStatus: displayStatus({
        enrollmentStatus: row.enrollmentStatus,
        percentage: row.percentage,
        lastActivityAt: row.lastActivityAt,
        activeCutoff: cutoff,
      }),
    }));

    return { items, meta: buildMeta(query.page, query.pageSize, total) };
  },

  /**
   * One learner's progress in **this** course.
   *
   * The privacy boundary the spec draws: display name, email and their
   * progress here. Not their other courses, not their role, not their
   * account state, not when they joined. The `select` is narrow on
   * purpose — the shape is the enforcement, not a filter applied later
   * that someone can forget.
   *
   * A learner who is not enrolled in this course answers 404, so an
   * instructor cannot use this endpoint to confirm that an arbitrary user
   * id exists.
   */
  async learnerProgress(
    courseId: string,
    learnerId: string,
    actor: AuthUser,
  ): Promise<LearnerCourseProgress> {
    const course = await this.loadCourse(courseId, actor);

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: learnerId, courseId } },
      select: {
        enrolledAt: true,
        completedAt: true,
        lastAccessedAt: true,
        status: true,
        user: { select: LEARNER_FIELDS },
      },
    });
    // Not enrolled here: indistinguishable from not existing.
    if (!enrollment || enrollment.status === 'CANCELLED') {
      throw new NotFoundError('Learner');
    }

    const [lessons, progressRows, aggregate, averages] = await Promise.all([
      prisma.lesson.findMany({
        where: { courseId },
        orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
        select: {
          id: true,
          title: true,
          durationSeconds: true,
          module: { select: { title: true } },
        },
      }),
      prisma.lessonProgress.findMany({
        where: { userId: learnerId, lesson: { courseId } },
      }),
      prisma.lesson.aggregate({
        where: { courseId },
        _sum: { durationSeconds: true },
        _count: { _all: true },
      }),
      analyticsRepository.progressDistribution(courseId, course.createdById),
    ]);

    const byLesson = new Map(progressRows.map((row) => [row.lessonId, row]));
    const completedLessons = progressRows.filter((row) => row.isCompleted).length;
    const totalLessons = aggregate._count._all;

    // The return type is annotated rather than asserted: an assertion here
    // would be flagged as redundant, while without either the `status`
    // literals widen to `string` and no longer satisfy the shared schema.
    const projected: LearnerCourseProgress['lessons'] = lessons.map((lesson, index) => {
      const progress = byLesson.get(lesson.id);
      return {
        lessonId: lesson.id,
        order: index + 1,
        moduleTitle: lesson.module.title,
        title: lesson.title,
        durationSeconds: lesson.durationSeconds,
        status: progress?.isCompleted
          ? 'COMPLETED'
          : (progress?.maxWatchedSeconds ?? 0) > 0
            ? 'IN_PROGRESS'
            : 'NOT_STARTED',
        completedAt: progress?.completedAt?.toISOString() ?? null,
        lastPositionSeconds: progress?.lastPositionSeconds ?? 0,
        updatedAt: progress?.updatedAt.toISOString() ?? null,
      };
    });

    // The most recently touched lesson, for the "Last watched" card.
    const latest = [...progressRows]
      .filter((row) => row.maxWatchedSeconds > 0)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const latestLesson = latest ? lessons.find((row) => row.id === latest.lessonId) : undefined;

    const distributionTotal = averages.reduce((sum, row) => sum + row.count, 0);
    const courseAverage =
      distributionTotal === 0
        ? 0
        : Math.round(
            averages.reduce((sum, row) => sum + row.meanPercentage * row.count, 0) /
              distributionTotal,
          );

    return {
      learner: {
        userId: enrollment.user.id,
        firstName: enrollment.user.firstName,
        lastName: enrollment.user.lastName,
        email: enrollment.user.email,
      },
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        status: course.status,
        lessonCount: totalLessons,
        estimatedDuration: aggregate._sum.durationSeconds ?? 0,
        averageProgress: courseAverage,
      },
      enrolledAt: enrollment.enrolledAt.toISOString(),
      completedAt: enrollment.completedAt?.toISOString() ?? null,
      lastActivityAt:
        (latest?.updatedAt ?? enrollment.lastAccessedAt)?.toISOString() ?? null,
      progressPercentage:
        totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100),
      completedLessons,
      // "Time watched": the furthest point reached in each lesson, summed.
      totalWatchedSeconds: progressRows.reduce(
        (sum, row) => sum + row.maxWatchedSeconds,
        0,
      ),
      enrollmentStatus: enrollment.status,
      lessons: projected,
      lastWatched:
        latest && latestLesson
          ? {
              lessonId: latestLesson.id,
              title: latestLesson.title,
              positionSeconds: latest.lastPositionSeconds,
              durationSeconds: latestLesson.durationSeconds,
              at: latest.updatedAt.toISOString(),
            }
          : null,
    };
  },
};

export { bandFor, displayStatus, activeCutoff };
