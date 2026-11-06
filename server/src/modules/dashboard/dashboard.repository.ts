import type { ActivityType } from '@cadence/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * Dashboard aggregates.
 *
 * Every number here is computed by Postgres — `COUNT`, `SUM`, `GROUP BY` —
 * never by fetching rows and counting them in Node.  Nothing is hardcoded.
 *
 * There is no `activity` table: an activity feed is a projection of facts
 * already recorded on `enrollments` and `lesson_progress`.  Adding a write-side
 * event log would be the right move for a real audit trail (noted as future
 * work), but inventing one here would mean a second source of truth for the
 * same facts.
 */

export type ActivityRow = {
  id: string;
  type: ActivityType;
  occurredAt: Date;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  lessonId: string | null;
  lessonTitle: string | null;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
};

/**
 * The feed, as a UNION of the four things that can happen, ordered and paged
 * in SQL.  `userId` is NULL-safe: pass one to scope the feed to a learner,
 * omit it for the admin's platform-wide view.
 */
async function queryActivity(params: {
  userId?: string | undefined;
  limit: number;
  offset: number;
}): Promise<ActivityRow[]> {
  const userId = params.userId ?? null;
  return prisma.$queryRaw<ActivityRow[]>`
    WITH feed AS (
      -- Enrolled
      SELECT e."id"::text AS id,
             'ENROLLED' AS type,
             e."enrolledAt" AS "occurredAt",
             c."id" AS "courseId", c."title" AS "courseTitle", c."slug" AS "courseSlug",
             NULL::uuid AS "lessonId", NULL::varchar AS "lessonTitle",
             u."id" AS "userId", u."firstName", u."lastName", u."email"
      FROM "enrollments" e
      JOIN "courses" c ON c."id" = e."courseId"
      JOIN "users" u ON u."id" = e."userId"
      WHERE (${userId}::uuid IS NULL OR e."userId" = ${userId}::uuid)

      UNION ALL

      -- Course completed
      SELECT e."id"::text || ':done' AS id,
             'COURSE_COMPLETED' AS type,
             e."completedAt" AS "occurredAt",
             c."id", c."title", c."slug",
             NULL::uuid, NULL::varchar,
             u."id", u."firstName", u."lastName", u."email"
      FROM "enrollments" e
      JOIN "courses" c ON c."id" = e."courseId"
      JOIN "users" u ON u."id" = e."userId"
      WHERE e."completedAt" IS NOT NULL
        AND (${userId}::uuid IS NULL OR e."userId" = ${userId}::uuid)

      UNION ALL

      -- Lesson completed
      SELECT p."id"::text || ':done' AS id,
             'LESSON_COMPLETED' AS type,
             p."completedAt" AS "occurredAt",
             c."id", c."title", c."slug",
             l."id", l."title",
             u."id", u."firstName", u."lastName", u."email"
      FROM "lesson_progress" p
      JOIN "lessons" l ON l."id" = p."lessonId"
      JOIN "courses" c ON c."id" = l."courseId"
      JOIN "users" u ON u."id" = p."userId"
      WHERE p."completedAt" IS NOT NULL
        AND (${userId}::uuid IS NULL OR p."userId" = ${userId}::uuid)

      UNION ALL

      -- Lesson started (watched, not yet finished)
      SELECT p."id"::text || ':start' AS id,
             'LESSON_STARTED' AS type,
             p."createdAt" AS "occurredAt",
             c."id", c."title", c."slug",
             l."id", l."title",
             u."id", u."firstName", u."lastName", u."email"
      FROM "lesson_progress" p
      JOIN "lessons" l ON l."id" = p."lessonId"
      JOIN "courses" c ON c."id" = l."courseId"
      JOIN "users" u ON u."id" = p."userId"
      WHERE p."isCompleted" = FALSE
        AND p."maxWatchedSeconds" > 0
        AND (${userId}::uuid IS NULL OR p."userId" = ${userId}::uuid)
    )
    SELECT * FROM feed
    ORDER BY "occurredAt" DESC
    LIMIT ${params.limit} OFFSET ${params.offset}
  `;
}

export const dashboardRepository = {
  queryActivity,

  async countActivity(userId?: string): Promise<number> {
    const scope = userId ?? null;
    const rows = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT (
        (SELECT COUNT(*) FROM "enrollments" e
          WHERE (${scope}::uuid IS NULL OR e."userId" = ${scope}::uuid))
        + (SELECT COUNT(*) FROM "enrollments" e
            WHERE e."completedAt" IS NOT NULL
              AND (${scope}::uuid IS NULL OR e."userId" = ${scope}::uuid))
        + (SELECT COUNT(*) FROM "lesson_progress" p
            WHERE p."completedAt" IS NOT NULL
              AND (${scope}::uuid IS NULL OR p."userId" = ${scope}::uuid))
        + (SELECT COUNT(*) FROM "lesson_progress" p
            WHERE p."isCompleted" = FALSE AND p."maxWatchedSeconds" > 0
              AND (${scope}::uuid IS NULL OR p."userId" = ${scope}::uuid))
      ) AS total
    `;
    return Number(rows[0]?.total ?? 0);
  },

  /** Learner headline numbers, in one round trip of grouped queries. */
  async learnerStats(userId: string) {
    const [enrollmentsByStatus, completedLessons, watched, totalLessonsRow] = await Promise.all([
      prisma.enrollment.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.lessonProgress.count({ where: { userId, isCompleted: true } }),
      prisma.lessonProgress.aggregate({
        where: { userId },
        _sum: { maxWatchedSeconds: true },
      }),
      // Lessons across every course this learner is on.
      prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(l."id") AS total
        FROM "enrollments" e
        JOIN "lessons" l ON l."courseId" = e."courseId"
        WHERE e."userId" = ${userId}::uuid AND e."status" <> 'CANCELLED'
      `,
    ]);

    const byStatus = new Map(enrollmentsByStatus.map((row) => [row.status, row._count._all]));
    return {
      activeCourses: byStatus.get('ACTIVE') ?? 0,
      completedCourses: byStatus.get('COMPLETED') ?? 0,
      cancelledCourses: byStatus.get('CANCELLED') ?? 0,
      completedLessons,
      watchedSeconds: watched._sum.maxWatchedSeconds ?? 0,
      totalLessons: Number(totalLessonsRow[0]?.total ?? 0),
    };
  },

  /**
   * The learner's current streak, in consecutive days up to today, and how
   * many lessons they finished in the last seven days.
   *
   * Both are derived from `lesson_progress` rather than stored, so neither can
   * be stale. The streak counts distinct local days on which the learner
   * touched a lesson, walking back from today (or from yesterday, so an
   * unfinished today does not read as a broken streak).
   *
   * The artifact's app home shows "4-day streak · 2h 05m this week". The
   * weekly *time* is not derivable from this schema — `maxWatchedSeconds` is
   * cumulative per lesson, not per day — so the second figure is a lesson
   * count instead of an invented duration. Recorded in docs/design-notes.md.
   */
  async learnerActivitySummary(
    userId: string,
  ): Promise<{ streakDays: number; lessonsThisWeek: number }> {
    const [days, completedThisWeek] = await Promise.all([
      prisma.$queryRaw<{ day: Date }[]>`
        SELECT DISTINCT DATE_TRUNC('day', p."updatedAt") AS day
        FROM "lesson_progress" p
        WHERE p."userId" = ${userId}::uuid
          AND p."updatedAt" > NOW() - INTERVAL '60 days'
        ORDER BY day DESC
      `,
      prisma.lessonProgress.count({
        where: {
          userId,
          isCompleted: true,
          completedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const seen = new Set(days.map((row) => row.day.toISOString().slice(0, 10)));
    const dayKey = (offset: number) =>
      new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Start at today if there was activity, else yesterday; a streak should
    // not be reported as broken before the day is over.
    let offset = seen.has(dayKey(0)) ? 0 : 1;
    let streakDays = 0;
    while (seen.has(dayKey(offset))) {
      streakDays++;
      offset++;
    }

    return { streakDays, lessonsThisWeek: completedThisWeek };
  },

  /** Where the learner left off: the most recently touched enrollment. */
  async continueLearning(userId: string) {
    const enrollment = await prisma.enrollment.findFirst({
      where: { userId, status: 'ACTIVE', lastLessonId: { not: null } },
      orderBy: { lastAccessedAt: 'desc' },
      select: { courseId: true, lastLessonId: true },
    });
    if (!enrollment?.lastLessonId) return null;

    const lesson = await prisma.lesson.findUnique({
      where: { id: enrollment.lastLessonId },
      select: {
        id: true,
        title: true,
        durationSeconds: true,
        module: { select: { title: true } },
        course: { select: { id: true, slug: true, title: true, thumbnailUrl: true } },
      },
    });
    if (!lesson) return null;

    const [progress, totalLessons, completedLessons] = await Promise.all([
      prisma.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
        select: { lastPositionSeconds: true },
      }),
      prisma.lesson.count({ where: { courseId: enrollment.courseId } }),
      prisma.lessonProgress.count({
        where: { userId, isCompleted: true, lesson: { courseId: enrollment.courseId } },
      }),
    ]);

    return { lesson, progress, totalLessons, completedLessons };
  },

  /** Platform-wide counts for the admin overview. */
  async adminStats() {
    const [
      learners,
      activeLearners,
      coursesByStatus,
      lessons,
      enrollments,
      completedLessons,
      completedCourses,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'LEARNER' } }),
      prisma.user.count({ where: { role: 'LEARNER', isActive: true } }),
      prisma.course.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.lesson.count(),
      prisma.enrollment.count({ where: { status: { not: 'CANCELLED' } } }),
      prisma.lessonProgress.count({ where: { isCompleted: true } }),
      prisma.enrollment.count({ where: { status: 'COMPLETED' } }),
    ]);

    const byStatus = new Map(coursesByStatus.map((row) => [row.status, row._count._all]));
    const published = byStatus.get('PUBLISHED') ?? 0;
    const draft = byStatus.get('DRAFT') ?? 0;
    const archived = byStatus.get('ARCHIVED') ?? 0;

    return {
      learners,
      activeLearners,
      courses: published + draft + archived,
      publishedCourses: published,
      draftCourses: draft,
      archivedCourses: archived,
      lessons,
      enrollments,
      completedLessons,
      completedCourses,
    };
  },

  /** Enrollments and completions per course, for the admin chart. */
  async coursePerformance(limit = 8) {
    const rows = await prisma.$queryRaw<
      { courseId: string; title: string; enrollments: bigint; completions: bigint }[]
    >`
      SELECT c."id" AS "courseId",
             c."title" AS "title",
             COUNT(e."id") FILTER (WHERE e."status" <> 'CANCELLED') AS "enrollments",
             COUNT(e."id") FILTER (WHERE e."status" = 'COMPLETED') AS "completions"
      FROM "courses" c
      LEFT JOIN "enrollments" e ON e."courseId" = c."id"
      WHERE c."status" = 'PUBLISHED'
      GROUP BY c."id", c."title"
      ORDER BY "enrollments" DESC, c."title" ASC
      LIMIT ${limit}
    `;
    return rows.map((row) => {
      const enrollments = Number(row.enrollments);
      const completions = Number(row.completions);
      return {
        courseId: row.courseId,
        title: row.title,
        enrollments,
        completions,
        completionRate: enrollments === 0 ? 0 : Math.round((completions / enrollments) * 100),
      };
    });
  },
};
