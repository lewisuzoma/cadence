import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Aggregates for the teaching workspace.
 *
 * Every figure here is grouped in Postgres. The alternative — loading
 * enrollments and progress rows and counting them in JavaScript — would turn
 * an instructor with a few hundred learners into a few hundred thousand rows
 * crossing the wire to produce six numbers, and it is the thing the spec
 * explicitly rules out.
 *
 * `$queryRaw` is used where a join is needed that Prisma's `groupBy` cannot
 * express (it groups on columns of one model only). Every interpolation is a
 * tagged-template parameter, never string concatenation.
 */

export type CourseRollup = {
  courseId: string;
  enrolled: number;
  completed: number;
  newEnrollments7d: number;
};

export const instructorRepository = {
  /** Course ids owned by this actor, which every other query is scoped by. */
  async ownedCourseIds(ownerId: string): Promise<string[]> {
    const rows = await prisma.course.findMany({
      where: { createdById: ownerId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  /**
   * Enrollment counts per course.
   *
   * Cancelled enrollments are excluded, and so is the owner themselves — an
   * instructor cannot enroll in their own course, but an admin acting on one
   * might have, and counting them would inflate every figure on the page.
   */
  async enrollmentRollup(courseIds: string[], ownerId: string): Promise<CourseRollup[]> {
    if (courseIds.length === 0) return [];
    const rows = await prisma.$queryRaw<
      { courseId: string; enrolled: bigint; completed: bigint; recent: bigint }[]
    >`
      SELECT
        e."courseId"                                                        AS "courseId",
        COUNT(*)                                                            AS "enrolled",
        COUNT(*) FILTER (WHERE e."status" = 'COMPLETED')                    AS "completed",
        COUNT(*) FILTER (WHERE e."enrolledAt" >= NOW() - INTERVAL '7 days')  AS "recent"
      FROM "enrollments" e
      JOIN "users" u ON u."id" = e."userId"
      WHERE e."courseId" = ANY(${courseIds}::uuid[])
        AND e."status" <> 'CANCELLED'
        AND e."userId" <> ${ownerId}::uuid
        AND u."role" <> 'ADMIN'
      GROUP BY e."courseId"
    `;
    return rows.map((row) => ({
      courseId: row.courseId,
      enrolled: Number(row.enrolled),
      completed: Number(row.completed),
      newEnrollments7d: Number(row.recent),
    }));
  },

  /** Distinct learners across a set of courses — not the sum of per-course counts. */
  async distinctLearners(courseIds: string[], ownerId: string): Promise<number> {
    if (courseIds.length === 0) return 0;
    const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT e."userId") AS "count"
      FROM "enrollments" e
      JOIN "users" u ON u."id" = e."userId"
      WHERE e."courseId" = ANY(${courseIds}::uuid[])
        AND e."status" <> 'CANCELLED'
        AND e."userId" <> ${ownerId}::uuid
        AND u."role" <> 'ADMIN'
    `;
    return Number(row?.count ?? 0);
  },

  /** New enrollments in the last 7 days across a set of courses. */
  async newEnrollments(courseIds: string[], ownerId: string, days: number): Promise<number> {
    if (courseIds.length === 0) return 0;
    const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS "count"
      FROM "enrollments" e
      JOIN "users" u ON u."id" = e."userId"
      WHERE e."courseId" = ANY(${courseIds}::uuid[])
        AND e."status" <> 'CANCELLED'
        AND e."userId" <> ${ownerId}::uuid
        AND u."role" <> 'ADMIN'
        AND e."enrolledAt" >= NOW() - MAKE_INTERVAL(days => ${days}::int)
    `;
    return Number(row?.count ?? 0);
  },

  /** Completed lessons across a set of courses, excluding the owner. */
  async lessonsCompleted(courseIds: string[], ownerId: string): Promise<number> {
    if (courseIds.length === 0) return 0;
    const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS "count"
      FROM "lesson_progress" p
      JOIN "lessons" l ON l."id" = p."lessonId"
      JOIN "users" u ON u."id" = p."userId"
      WHERE l."courseId" = ANY(${courseIds}::uuid[])
        AND p."isCompleted" = TRUE
        AND p."userId" <> ${ownerId}::uuid
        AND u."role" <> 'ADMIN'
    `;
    return Number(row?.count ?? 0);
  },

  /**
   * Mean course progress per course, computed entirely in SQL.
   *
   * Progress is "completed lessons ÷ total lessons" per learner, averaged
   * over learners — the same definition the learner-facing figure uses, so
   * an instructor and a learner never see two different numbers for the same
   * thing.
   */
  async averageProgress(
    courseIds: string[],
    ownerId: string,
  ): Promise<{ courseId: string; averageProgress: number | null }[]> {
    if (courseIds.length === 0) return [];
    const rows = await prisma.$queryRaw<{ courseId: string; avg: number | null }[]>`
      WITH totals AS (
        SELECT "courseId", COUNT(*)::numeric AS total
        FROM "lessons"
        WHERE "courseId" = ANY(${courseIds}::uuid[])
        GROUP BY "courseId"
      ),
      per_learner AS (
        SELECT
          e."courseId",
          e."userId",
          COALESCE(COUNT(p."id") FILTER (WHERE p."isCompleted"), 0)::numeric AS done
        FROM "enrollments" e
        JOIN "users" u ON u."id" = e."userId"
        LEFT JOIN "lessons" l ON l."courseId" = e."courseId"
        LEFT JOIN "lesson_progress" p
          ON p."lessonId" = l."id" AND p."userId" = e."userId"
        WHERE e."courseId" = ANY(${courseIds}::uuid[])
          AND e."status" <> 'CANCELLED'
          AND e."userId" <> ${ownerId}::uuid
          AND u."role" <> 'ADMIN'
        GROUP BY e."courseId", e."userId"
      )
      SELECT
        t."courseId" AS "courseId",
        AVG(
          CASE WHEN t.total = 0 THEN 0
               ELSE LEAST(100, ROUND(pl.done / t.total * 100))
          END
        )::float AS "avg"
      FROM totals t
      LEFT JOIN per_learner pl ON pl."courseId" = t."courseId"
      GROUP BY t."courseId"
    `;
    return rows.map((row) => ({
      courseId: row.courseId,
      averageProgress: row.avg === null ? null : Math.round(row.avg),
    }));
  },

  /** How many lessons of each course still have no playable video. */
  async lessonsNeedingVideo(
    courseIds: string[],
  ): Promise<{ courseId: string; count: number }[]> {
    if (courseIds.length === 0) return [];
    const rows = await prisma.$queryRaw<{ courseId: string; count: bigint }[]>`
      SELECT l."courseId" AS "courseId", COUNT(*) AS "count"
      FROM "lessons" l
      LEFT JOIN "media_assets" m ON m."id" = l."videoAssetId"
      WHERE l."courseId" = ANY(${courseIds}::uuid[])
        AND (
          CASE
            WHEN l."videoAssetId" IS NOT NULL THEN m."status" <> 'READY'
            -- Mirrors isPlayableVideoUrl: an https URL or a path this
            -- app serves itself. Kept as SQL because counting these in
            -- JavaScript would mean loading every lesson of every course.
            ELSE (l."videoUrl" NOT LIKE 'https://%' AND l."videoUrl" NOT LIKE '/%')
          END
        )
      GROUP BY l."courseId"
    `;
    return rows.map((row) => ({ courseId: row.courseId, count: Number(row.count) }));
  },

  /** Recent enrollments on the actor's courses, newest first. */
  recentEnrollments(courseIds: string[], ownerId: string, since: Date, take: number) {
    if (courseIds.length === 0) return Promise.resolve([]);
    return prisma.enrollment.findMany({
      where: {
        courseId: { in: courseIds },
        status: { not: 'CANCELLED' },
        enrolledAt: { gte: since },
        userId: { not: ownerId },
        user: { role: { not: 'ADMIN' } },
      },
      orderBy: { enrolledAt: 'desc' },
      take,
      select: {
        id: true,
        enrolledAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        course: { select: { id: true, title: true } },
      },
    });
  },

  /** Recent lesson completions on the actor's courses. */
  recentCompletions(courseIds: string[], ownerId: string, since: Date, take: number) {
    if (courseIds.length === 0) return Promise.resolve([]);
    return prisma.lessonProgress.findMany({
      where: {
        isCompleted: true,
        completedAt: { gte: since },
        userId: { not: ownerId },
        user: { role: { not: 'ADMIN' } },
        lesson: { courseId: { in: courseIds } },
      },
      orderBy: { completedAt: 'desc' },
      take,
      select: {
        id: true,
        completedAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        lesson: {
          select: { id: true, title: true, course: { select: { id: true, title: true } } },
        },
      },
    });
  },

  /** Course lifecycle events the actor performed. */
  recentCourseEvents(courseIds: string[], since: Date, take: number) {
    if (courseIds.length === 0) return Promise.resolve([]);
    return prisma.courseEvent.findMany({
      where: { courseId: { in: courseIds }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        type: true,
        createdAt: true,
        course: { select: { id: true, title: true } },
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  },

  /**
   * Learners who have crossed a 25 / 50 / 75 / 100 % milestone recently.
   *
   * Computed from the real progress rows rather than stored, so the feed
   * cannot drift from the numbers on the analytics page. The milestone is
   * the highest band the learner's current percentage clears, and the
   * timestamp is their latest completion.
   */
  async recentMilestones(courseIds: string[], ownerId: string, since: Date, take: number) {
    if (courseIds.length === 0) return [];
    return prisma.$queryRaw<
      {
        userId: string;
        firstName: string;
        lastName: string;
        courseId: string;
        courseTitle: string;
        milestone: number;
        at: Date;
      }[]
    >`
      WITH totals AS (
        SELECT "courseId", COUNT(*)::numeric AS total
        FROM "lessons"
        WHERE "courseId" = ANY(${courseIds}::uuid[])
        GROUP BY "courseId"
      ),
      per_learner AS (
        SELECT
          l."courseId",
          p."userId",
          COUNT(*)::numeric      AS done,
          MAX(p."completedAt")   AS "at"
        FROM "lesson_progress" p
        JOIN "lessons" l ON l."id" = p."lessonId"
        JOIN "users" u ON u."id" = p."userId"
        WHERE l."courseId" = ANY(${courseIds}::uuid[])
          AND p."isCompleted" = TRUE
          AND p."userId" <> ${ownerId}::uuid
          AND u."role" <> 'ADMIN'
        GROUP BY l."courseId", p."userId"
      ),
      scored AS (
        SELECT
          pl."courseId",
          pl."userId",
          pl."at",
          ROUND(pl.done / NULLIF(t.total, 0) * 100) AS pct
        FROM per_learner pl
        JOIN totals t ON t."courseId" = pl."courseId"
        WHERE pl."at" >= ${since}
      )
      SELECT
        s."userId"    AS "userId",
        u."firstName" AS "firstName",
        u."lastName"  AS "lastName",
        s."courseId"  AS "courseId",
        c."title"     AS "courseTitle",
        (CASE
          WHEN s.pct >= 100 THEN 100
          WHEN s.pct >= 75  THEN 75
          WHEN s.pct >= 50  THEN 50
          ELSE 25
        END)::int     AS "milestone",
        s."at"        AS "at"
      FROM scored s
      JOIN "users" u ON u."id" = s."userId"
      JOIN "courses" c ON c."id" = s."courseId"
      WHERE s.pct >= 25
      ORDER BY s."at" DESC
      LIMIT ${take}
    `;
  },

  /** Course rows for the workspace list, scoped and filtered. */
  listOwnedCourses(params: {
    where: Prisma.CourseWhereInput;
    orderBy: Prisma.CourseOrderByWithRelationInput[];
    skip: number;
    take: number;
  }) {
    return Promise.all([
      prisma.course.findMany({
        where: params.where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
        select: {
          id: true,
          slug: true,
          title: true,
          shortDescription: true,
          category: true,
          thumbnailUrl: true,
          difficulty: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
        },
      }),
      prisma.course.count({ where: params.where }),
    ]);
  },

  /**
   * The live version number of each course, and whether the draft has
   * moved on since it was published.
   *
   * `updatedAt > publishedAt` is a cheap proxy for "something changed",
   * good enough for a badge on a card. The editor runs the real
   * field-by-field diff when the instructor opens the course, so a false
   * positive here costs a banner that then lists no changes, never a
   * missed one.
   */
  async liveVersionNumbers(courseIds: string[]) {
    if (courseIds.length === 0) return [];
    const rows = await prisma.course.findMany({
      where: { id: { in: courseIds }, liveVersionId: { not: null } },
      select: {
        id: true,
        updatedAt: true,
        liveVersion: { select: { version: true, publishedAt: true } },
      },
    });
    return rows.map((row) => ({
      courseId: row.id,
      version: row.liveVersion?.version ?? null,
      stale: row.liveVersion
        ? row.updatedAt.getTime() > row.liveVersion.publishedAt.getTime() + 1000
        : false,
    }));
  },

  /** Status counts for the All / Published / Drafts / Archived tabs. */
  async statusCounts(ownerId: string) {
    const grouped = await prisma.course.groupBy({
      by: ['status'],
      where: { createdById: ownerId },
      _count: { _all: true },
    });
    const counts = { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const row of grouped) counts[row.status] = row._count._all;
    return counts;
  },
};
