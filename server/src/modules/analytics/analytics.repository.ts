import { Prisma } from '@prisma/client';
import type { ProgressBand } from '@cadence/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * Analytics aggregates, computed in Postgres.
 *
 * Every query here excludes two groups from "learners": the course's own
 * owner, and admins. Both can hold an enrollment in odd circumstances, and
 * counting staff as students would quietly bias every figure on the page.
 * The exclusion is written into each query rather than applied afterwards,
 * so a new query cannot forget it without the tests noticing.
 *
 * `$queryRaw` is used where a join is needed that Prisma's `groupBy`
 * cannot express. Every interpolation is a tagged-template parameter, so
 * none of this is string-concatenated SQL.
 */

/** The learner filter every query shares. */
const LEARNER_FILTER = (courseId: string, ownerId: string) => Prisma.sql`
  e."courseId" = ${courseId}::uuid
  AND e."status" <> 'CANCELLED'
  AND e."userId" <> ${ownerId}::uuid
  AND u."role" <> 'ADMIN'
`;

export type LearnerRow = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  enrolledAt: Date;
  percentage: number;
  completedLessons: number;
  totalLessons: number;
  lastActivityAt: Date | null;
  enrollmentStatus: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
};

export const analyticsRepository = {
  /** The six stat-card figures, in one round trip. */
  async courseTotals(courseId: string, ownerId: string, cutoff: Date) {
    const [row] = await prisma.$queryRaw<
      {
        enrolled: bigint;
        completed: bigint;
        active: bigint;
        avgProgress: number | null;
        lessonsCompleted: bigint;
        firstEnrollmentAt: Date | null;
      }[]
    >`
      WITH total AS (
        SELECT COUNT(*)::numeric AS lessons
        FROM "lessons" WHERE "courseId" = ${courseId}::uuid
      ),
      learners AS (
        SELECT
          e."userId",
          e."status",
          e."enrolledAt",
          COALESCE((
            SELECT COUNT(*) FROM "lesson_progress" p
            JOIN "lessons" l ON l."id" = p."lessonId"
            WHERE l."courseId" = ${courseId}::uuid
              AND p."userId" = e."userId"
              AND p."isCompleted" = TRUE
          ), 0)::numeric AS done,
          GREATEST(
            COALESCE(e."lastAccessedAt", e."enrolledAt"),
            COALESCE((
              SELECT MAX(p."updatedAt") FROM "lesson_progress" p
              JOIN "lessons" l ON l."id" = p."lessonId"
              WHERE l."courseId" = ${courseId}::uuid AND p."userId" = e."userId"
            ), e."enrolledAt")
          ) AS "lastActivity"
        FROM "enrollments" e
        JOIN "users" u ON u."id" = e."userId"
        WHERE ${LEARNER_FILTER(courseId, ownerId)}
      )
      SELECT
        COUNT(*)                                                       AS "enrolled",
        COUNT(*) FILTER (WHERE "status" = 'COMPLETED')                 AS "completed",
        COUNT(*) FILTER (WHERE "lastActivity" >= ${cutoff})            AS "active",
        AVG(
          CASE WHEN (SELECT lessons FROM total) = 0 THEN 0
               ELSE LEAST(100, ROUND(done / (SELECT lessons FROM total) * 100))
          END
        )::float                                                       AS "avgProgress",
        COALESCE(SUM(done), 0)                                         AS "lessonsCompleted",
        MIN("enrolledAt")                                              AS "firstEnrollmentAt"
      FROM learners
    `;

    return {
      enrolled: Number(row?.enrolled ?? 0),
      completed: Number(row?.completed ?? 0),
      active: Number(row?.active ?? 0),
      averageProgress: row?.avgProgress === null ? 0 : Math.round(row?.avgProgress ?? 0),
      lessonsCompleted: Number(row?.lessonsCompleted ?? 0),
      firstEnrollmentAt: row?.firstEnrollmentAt ?? null,
    };
  },

  /**
   * New enrollments per ISO week, in UTC.
   *
   * `date_trunc('week', ...)` starts weeks on Monday, which is what the
   * chart's caption promises. Weeks with no enrollments are absent rather
   * than zero-filled; the chart fills the gaps, because only it knows the
   * range it wants to draw.
   */
  async enrollmentsByWeek(courseId: string, ownerId: string) {
    const rows = await prisma.$queryRaw<{ weekStart: Date; count: bigint }[]>`
      SELECT
        date_trunc('week', e."enrolledAt" AT TIME ZONE 'UTC') AS "weekStart",
        COUNT(*)                                              AS "count"
      FROM "enrollments" e
      JOIN "users" u ON u."id" = e."userId"
      WHERE ${LEARNER_FILTER(courseId, ownerId)}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({ weekStart: row.weekStart, count: Number(row.count) }));
  },

  /**
   * How many learners fall in each progress band.
   *
   * Every band is returned, including the empty ones, so the chart draws a
   * complete axis instead of silently omitting a range.
   */
  async progressDistribution(courseId: string, ownerId: string) {
    const rows = await prisma.$queryRaw<
      { band: string; count: bigint; mean: number | null }[]
    >`
      WITH total AS (
        SELECT COUNT(*)::numeric AS lessons
        FROM "lessons" WHERE "courseId" = ${courseId}::uuid
      ),
      scored AS (
        SELECT
          CASE WHEN (SELECT lessons FROM total) = 0 THEN 0
               ELSE LEAST(100, ROUND(
                 COALESCE((
                   SELECT COUNT(*) FROM "lesson_progress" p
                   JOIN "lessons" l ON l."id" = p."lessonId"
                   WHERE l."courseId" = ${courseId}::uuid
                     AND p."userId" = e."userId"
                     AND p."isCompleted" = TRUE
                 ), 0)::numeric / (SELECT lessons FROM total) * 100
               ))
          END AS pct
        FROM "enrollments" e
        JOIN "users" u ON u."id" = e."userId"
        WHERE ${LEARNER_FILTER(courseId, ownerId)}
      )
      SELECT
        CASE
          WHEN pct >= 100 THEN '100'
          WHEN pct >= 75  THEN '75-99'
          WHEN pct >= 50  THEN '50-75'
          WHEN pct >= 25  THEN '25-50'
          ELSE '0-25'
        END                 AS "band",
        COUNT(*)            AS "count",
        AVG(pct)::float     AS "mean"
      FROM scored
      GROUP BY 1
    `;

    const found = new Map(
      rows.map((row) => [
        row.band,
        { count: Number(row.count), mean: Math.round(row.mean ?? 0) },
      ]),
    );
    const bands: ProgressBand[] = ['0-25', '25-50', '50-75', '75-99', '100'];
    return bands.map((band) => ({
      band,
      count: found.get(band)?.count ?? 0,
      meanPercentage: found.get(band)?.mean ?? 0,
    }));
  },

  /**
   * Completions per lesson, in course order.
   *
   * This is the drop-off chart: the step down between two bars is where
   * learners stop. Lessons with no completions are included as zeroes,
   * because a lesson nobody reached is exactly what the chart is for.
   */
  async lessonCompletion(courseId: string, ownerId: string) {
    const rows = await prisma.$queryRaw<
      { lessonId: string; title: string; position: bigint; completed: bigint }[]
    >`
      SELECT
        l."id"    AS "lessonId",
        l."title" AS "title",
        ROW_NUMBER() OVER (ORDER BY m."order" ASC, l."order" ASC) AS "position",
        COALESCE((
          SELECT COUNT(*)
          FROM "lesson_progress" p
          JOIN "enrollments" e
            ON e."userId" = p."userId" AND e."courseId" = ${courseId}::uuid
          JOIN "users" u ON u."id" = p."userId"
          WHERE p."lessonId" = l."id"
            AND p."isCompleted" = TRUE
            AND e."status" <> 'CANCELLED'
            AND p."userId" <> ${ownerId}::uuid
            AND u."role" <> 'ADMIN'
        ), 0) AS "completed"
      FROM "lessons" l
      JOIN "modules" m ON m."id" = l."moduleId"
      WHERE l."courseId" = ${courseId}::uuid
      ORDER BY m."order" ASC, l."order" ASC
    `;
    return rows.map((row) => ({
      lessonId: row.lessonId,
      title: row.title,
      order: Number(row.position),
      completed: Number(row.completed),
    }));
  },

  /**
   * One page of the enrolled-learners table.
   *
   * Search, filters, sorting and paging all happen in SQL. Doing any of it
   * in JavaScript would mean fetching every learner on the course to show
   * ten of them.
   */
  async learnerPage(params: {
    courseId: string;
    ownerId: string;
    search?: string | undefined;
    status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'INACTIVE' | undefined;
    band?: ProgressBand | undefined;
    sort: 'name' | 'enrolled' | 'progress' | 'activity';
    direction: 'asc' | 'desc';
    cutoff: Date;
    skip: number;
    take: number;
  }): Promise<{ rows: LearnerRow[]; total: number }> {
    const { courseId, ownerId, cutoff } = params;

    const search = params.search?.trim();
    const searchFilter = search
      ? Prisma.sql`AND (
          u."firstName" ILIKE ${`%${search}%`}
          OR u."lastName" ILIKE ${`%${search}%`}
          OR u."email" ILIKE ${`%${search}%`}
          OR (u."firstName" || ' ' || u."lastName") ILIKE ${`%${search}%`}
        )`
      : Prisma.empty;

    // Applied to the computed columns, so it has to live in the outer query.
    const statusFilter = params.status
      ? params.status === 'COMPLETED'
        ? Prisma.sql`AND "enrollmentStatus" = 'COMPLETED'`
        : params.status === 'NOT_STARTED'
          ? Prisma.sql`AND "enrollmentStatus" <> 'COMPLETED' AND "completedLessons" = 0 AND "startedAt" IS NULL`
          : params.status === 'INACTIVE'
            ? Prisma.sql`AND "enrollmentStatus" <> 'COMPLETED' AND "lastActivityAt" < ${cutoff}`
            : Prisma.sql`AND "enrollmentStatus" <> 'COMPLETED' AND "lastActivityAt" >= ${cutoff}`
      : Prisma.empty;

    const bandFilter = params.band
      ? params.band === '100'
        ? Prisma.sql`AND "percentage" >= 100`
        : params.band === '75-99'
          ? Prisma.sql`AND "percentage" >= 75 AND "percentage" < 100`
          : params.band === '50-75'
            ? Prisma.sql`AND "percentage" >= 50 AND "percentage" < 75`
            : params.band === '25-50'
              ? Prisma.sql`AND "percentage" >= 25 AND "percentage" < 50`
              : Prisma.sql`AND "percentage" < 25`
      : Prisma.empty;

    /*
     * The sort column is chosen from a closed set rather than
     * interpolated, so no caller can inject an ORDER BY. The direction is
     * likewise reduced to one of two literals.
     */
    const direction = params.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const orderBy =
      params.sort === 'name'
        ? Prisma.sql`"lastName" ${direction}, "firstName" ${direction}`
        : params.sort === 'enrolled'
          ? Prisma.sql`"enrolledAt" ${direction}`
          : params.sort === 'progress'
            ? Prisma.sql`"percentage" ${direction}, "lastName" ASC`
            : Prisma.sql`"lastActivityAt" ${direction} NULLS LAST`;

    const base = Prisma.sql`
      WITH total AS (
        SELECT COUNT(*)::numeric AS lessons
        FROM "lessons" WHERE "courseId" = ${courseId}::uuid
      ),
      rows AS (
        SELECT
          u."id"        AS "userId",
          u."firstName" AS "firstName",
          u."lastName"  AS "lastName",
          u."email"     AS "email",
          e."enrolledAt" AS "enrolledAt",
          e."status"     AS "enrollmentStatus",
          (SELECT lessons FROM total)::int AS "totalLessons",
          COALESCE(pr.done, 0)::int        AS "completedLessons",
          CASE WHEN (SELECT lessons FROM total) = 0 THEN 0
               ELSE LEAST(100, ROUND(COALESCE(pr.done, 0)::numeric / (SELECT lessons FROM total) * 100))
          END::int                         AS "percentage",
          pr."lastTouched"                 AS "startedAt",
          GREATEST(
            COALESCE(e."lastAccessedAt", e."enrolledAt"),
            COALESCE(pr."lastTouched", e."enrolledAt")
          )                                AS "lastActivityAt"
        FROM "enrollments" e
        JOIN "users" u ON u."id" = e."userId"
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE p."isCompleted") AS done,
            MAX(p."updatedAt")                      AS "lastTouched"
          FROM "lesson_progress" p
          JOIN "lessons" l ON l."id" = p."lessonId"
          WHERE l."courseId" = ${courseId}::uuid AND p."userId" = e."userId"
        ) pr ON TRUE
        WHERE ${LEARNER_FILTER(courseId, ownerId)}
        ${searchFilter}
      )
      SELECT * FROM rows
      WHERE TRUE ${statusFilter} ${bandFilter}
    `;

    const [rows, countRows] = await Promise.all([
      prisma.$queryRaw<LearnerRow[]>`
        ${base}
        ORDER BY ${orderBy}
        LIMIT ${params.take} OFFSET ${params.skip}
      `,
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS "count" FROM (${base}) counted
      `,
    ]);

    return { rows, total: Number(countRows[0]?.count ?? 0) };
  },
};
