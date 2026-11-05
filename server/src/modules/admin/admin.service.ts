import type {
  AdminCourseLearner,
  AdminLearnerDetail,
  AdminUserQuery,
  AdminUserRow,
} from '@cadence/shared';
import { NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { courseProgressPercentage } from '../progress/progress.calculator.js';
import { indexBy } from '../courses/courses.projection.js';

/**
 * Admin people management.
 *
 * The only mutation an admin has over a user is activation: there is no way to
 * promote someone to ADMIN through the API, and no way to read or reset a
 * password.  Role changes are a deliberate out-of-band operation (seed or a
 * direct database change), which keeps privilege escalation off the attack
 * surface entirely.
 */

type UserAggregates = {
  userId: string;
  enrolledCourses: number;
  completedCourses: number;
  completedLessons: number;
  totalLessons: number;
  lastActiveAt: Date | null;
};

/** Per-user roll-ups for a page of users, grouped in Postgres. */
async function aggregateForUsers(userIds: string[]): Promise<Map<string, UserAggregates>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    {
      userId: string;
      enrolledCourses: bigint;
      completedCourses: bigint;
      totalLessons: bigint;
      lastActiveAt: Date | null;
    }[]
  >`
    SELECT u."id" AS "userId",
           COUNT(DISTINCT e."id") FILTER (WHERE e."status" <> 'CANCELLED') AS "enrolledCourses",
           COUNT(DISTINCT e."id") FILTER (WHERE e."status" = 'COMPLETED') AS "completedCourses",
           COUNT(l."id") FILTER (WHERE e."status" <> 'CANCELLED') AS "totalLessons",
           MAX(e."lastAccessedAt") AS "lastActiveAt"
    FROM "users" u
    LEFT JOIN "enrollments" e ON e."userId" = u."id"
    LEFT JOIN "lessons" l ON l."courseId" = e."courseId"
    WHERE u."id" = ANY(${userIds}::uuid[])
    GROUP BY u."id"
  `;

  const completedRows = await prisma.$queryRaw<{ userId: string; completed: bigint }[]>`
    SELECT p."userId" AS "userId", COUNT(*) AS "completed"
    FROM "lesson_progress" p
    WHERE p."isCompleted" = TRUE AND p."userId" = ANY(${userIds}::uuid[])
    GROUP BY p."userId"
  `;
  const completedByUser = new Map(
    completedRows.map((row) => [row.userId, Number(row.completed)]),
  );

  return new Map(
    rows.map((row) => [
      row.userId,
      {
        userId: row.userId,
        enrolledCourses: Number(row.enrolledCourses),
        completedCourses: Number(row.completedCourses),
        completedLessons: completedByUser.get(row.userId) ?? 0,
        totalLessons: Number(row.totalLessons),
        lastActiveAt: row.lastActiveAt,
      },
    ]),
  );
}

function toUserRow(
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    isActive: boolean;
    createdAt: Date;
  },
  aggregate: UserAggregates | undefined,
): AdminUserRow {
  const completedLessons = aggregate?.completedLessons ?? 0;
  const totalLessons = aggregate?.totalLessons ?? 0;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role as AdminUserRow['role'],
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    enrolledCourses: aggregate?.enrolledCourses ?? 0,
    completedCourses: aggregate?.completedCourses ?? 0,
    completedLessons,
    overallProgressPercentage: courseProgressPercentage(completedLessons, totalLessons),
    lastActiveAt: aggregate?.lastActiveAt?.toISOString() ?? null,
  };
}

export const adminService = {
  async listUsers(query: AdminUserQuery) {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const where = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' as const } },
              { lastName: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const aggregates = await aggregateForUsers(users.map((user) => user.id));
    return {
      items: users.map((user) => toUserRow(user, aggregates.get(user.id))),
      meta: buildMeta(query.page, query.pageSize, total),
    };
  },

  async getLearner(userId: string): Promise<AdminLearnerDetail> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundError('User');

    const aggregates = await aggregateForUsers([userId]);

    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      orderBy: { enrolledAt: 'desc' },
      include: { course: { select: { id: true, title: true, slug: true } } },
    });

    const courseIds = enrollments.map((row) => row.courseId);
    const [lessonCounts, completedCounts] = await Promise.all([
      courseIds.length
        ? prisma.lesson.groupBy({
            by: ['courseId'],
            where: { courseId: { in: courseIds } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      courseIds.length
        ? prisma.$queryRaw<{ courseId: string; completed: bigint }[]>`
            SELECT l."courseId" AS "courseId", COUNT(*) AS "completed"
            FROM "lesson_progress" p
            JOIN "lessons" l ON l."id" = p."lessonId"
            WHERE p."userId" = ${userId}::uuid AND p."isCompleted" = TRUE
              AND l."courseId" = ANY(${courseIds}::uuid[])
            GROUP BY l."courseId"
          `
        : Promise.resolve([]),
    ]);

    const lessonCountByCourse = new Map(
      lessonCounts.map((row) => [row.courseId, row._count._all]),
    );
    const completedByCourse = new Map(
      completedCounts.map((row) => [row.courseId, Number(row.completed)]),
    );

    const progressRows = await prisma.lessonProgress.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        lesson: {
          select: {
            id: true,
            title: true,
            durationSeconds: true,
            course: { select: { title: true } },
          },
        },
      },
    });

    return {
      ...toUserRow(user, aggregates.get(userId)),
      courses: enrollments.map((row) => {
        const totalLessons = lessonCountByCourse.get(row.courseId) ?? 0;
        const completedLessons = completedByCourse.get(row.courseId) ?? 0;
        return {
          courseId: row.courseId,
          courseTitle: row.course.title,
          courseSlug: row.course.slug,
          status: row.status as AdminCourseLearner['status'],
          enrolledAt: row.enrolledAt.toISOString(),
          lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
          completedAt: row.completedAt?.toISOString() ?? null,
          completedLessons,
          totalLessons,
          progressPercentage: courseProgressPercentage(completedLessons, totalLessons),
        };
      }),
      lessons: progressRows.map((row) => ({
        lessonId: row.lessonId,
        lessonTitle: row.lesson.title,
        courseTitle: row.lesson.course.title,
        durationSeconds: row.lesson.durationSeconds,
        lastPositionSeconds: row.lastPositionSeconds,
        completionPercentage: row.completionPercentage,
        isCompleted: row.isCompleted,
        completedAt: row.completedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  },

  /** Activate or deactivate.  An admin may not deactivate themselves. */
  async setActive(
    actingAdminId: string,
    userId: string,
    isActive: boolean,
  ): Promise<AdminUserRow> {
    if (actingAdminId === userId && !isActive) {
      throw new UnprocessableError('You cannot deactivate your own account');
    }
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('User');

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Deactivation must end live sessions, not just block the next login.
    if (!isActive) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const aggregates = await aggregateForUsers([userId]);
    return toUserRow(user, aggregates.get(userId));
  },

  /** Everyone enrolled on one course, with their progress. */
  async courseLearners(courseId: string, page: number, pageSize: number) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) throw new NotFoundError('Course');

    const { skip, take } = toSkipTake(page, pageSize);
    const [rows, total, totalLessons] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId },
        orderBy: [{ lastAccessedAt: 'desc' }, { enrolledAt: 'desc' }],
        skip,
        take,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.enrollment.count({ where: { courseId } }),
      prisma.lesson.count({ where: { courseId } }),
    ]);

    const userIds = rows.map((row) => row.userId);
    const completed = userIds.length
      ? await prisma.$queryRaw<{ userId: string; completed: bigint }[]>`
          SELECT p."userId" AS "userId", COUNT(*) AS "completed"
          FROM "lesson_progress" p
          JOIN "lessons" l ON l."id" = p."lessonId"
          WHERE l."courseId" = ${courseId}::uuid
            AND p."isCompleted" = TRUE
            AND p."userId" = ANY(${userIds}::uuid[])
          GROUP BY p."userId"
        `
      : [];
    const completedByUser = indexBy(completed, (row) => row.userId);

    const items: AdminCourseLearner[] = rows.map((row) => {
      const completedLessons = Number(completedByUser.get(row.userId)?.completed ?? 0);
      return {
        userId: row.userId,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        email: row.user.email,
        status: row.status as AdminCourseLearner['status'],
        enrolledAt: row.enrolledAt.toISOString(),
        lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
        completedLessons,
        totalLessons,
        progressPercentage: courseProgressPercentage(completedLessons, totalLessons),
      };
    });

    return { items, meta: buildMeta(page, pageSize, total) };
  },
};
