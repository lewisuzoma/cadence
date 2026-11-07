import type { Prisma } from '@prisma/client';
import type { CourseSort } from '@cadence/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * Prisma access for courses, modules and lessons.
 *
 * The per-course roll-ups (lesson count, total duration, a learner's completed
 * lessons) are grouped in the database rather than counted in JavaScript, so
 * listing a page of courses stays at a handful of queries no matter how many
 * lessons each course has.
 */

export const courseListSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  shortDescription: true,
  category: true,
  thumbnailUrl: true,
  difficulty: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  learningObjectives: true,
  prerequisites: true,
  targetAudience: true,
  thumbnailAssetId: true,
} satisfies Prisma.CourseSelect;

export type CourseListRow = Prisma.CourseGetPayload<{ select: typeof courseListSelect }>;

/** Lesson count and summed duration for a set of courses, in one query. */
export type CourseAggregate = { courseId: string; lessonCount: number; totalDuration: number };

/** How many lessons of each course a given learner has completed. */
export type CompletedAggregate = { courseId: string; completed: number };

function orderBy(sort: CourseSort): Prisma.CourseOrderByWithRelationInput[] {
  switch (sort) {
    case 'oldest':
      return [{ createdAt: 'asc' }];
    case 'title':
      return [{ title: 'asc' }];
    case 'duration':
      // Duration is derived, so it cannot be ordered in SQL without a
      // subquery; the service sorts the page in memory and this keeps the
      // underlying order stable.  Documented in ARCHITECTURE.md.
      return [{ createdAt: 'desc' }];
    case 'newest':
    default:
      return [{ publishedAt: 'desc' }, { createdAt: 'desc' }];
  }
}

export const coursesRepository = {
  /** The public catalog: PUBLISHED only, with search and filters. */
  async listPublished(params: {
    skip: number;
    take: number;
    search?: string | undefined;
    category?: string | undefined;
    difficulty?: Prisma.EnumDifficultyFilter | undefined;
    sort: CourseSort;
  }) {
    const where: Prisma.CourseWhereInput = {
      status: 'PUBLISHED',
      ...(params.category ? { category: params.category } : {}),
      ...(params.difficulty ? { difficulty: params.difficulty } : {}),
      ...(params.search
        ? {
            OR: [
              { title: { contains: params.search, mode: 'insensitive' } },
              { description: { contains: params.search, mode: 'insensitive' } },
              { category: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where,
        select: courseListSelect,
        orderBy: orderBy(params.sort),
        skip: params.skip,
        take: params.take,
      }),
      prisma.course.count({ where }),
    ]);
    return { rows, total };
  },

  /** The admin catalog: every status, plus a status filter. */
  async listAll(params: {
    skip: number;
    take: number;
    search?: string | undefined;
    category?: string | undefined;
    status?: Prisma.EnumCourseStatusFilter | undefined;
    difficulty?: Prisma.EnumDifficultyFilter | undefined;
    sort: CourseSort;
  }) {
    const where: Prisma.CourseWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(params.difficulty ? { difficulty: params.difficulty } : {}),
      ...(params.search
        ? {
            OR: [
              { title: { contains: params.search, mode: 'insensitive' } },
              { description: { contains: params.search, mode: 'insensitive' } },
              { category: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where,
        select: courseListSelect,
        orderBy: params.sort === 'newest' ? [{ updatedAt: 'desc' }] : orderBy(params.sort),
        skip: params.skip,
        take: params.take,
      }),
      prisma.course.count({ where }),
    ]);
    return { rows, total };
  },

  findByIdOrSlug(idOrSlug: string, isId: boolean) {
    return prisma.course.findUnique({
      where: isId ? { id: idOrSlug } : { slug: idOrSlug },
      select: {
        ...courseListSelect,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  },

  findById(id: string) {
    return prisma.course.findUnique({ where: { id }, select: courseListSelect });
  },

  /**
   * Public instructor profiles for a set of courses, in one query.
   *
   * Returns only what the catalog is allowed to show. Courses whose owner has
   * no instructor profile — the admin-authored seed catalogue — are simply
   * absent from the map, and render without an instructor line.
   */
  async publicInstructorsForCourses(courseIds: string[]) {
    if (courseIds.length === 0) return [];
    const rows = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: {
        id: true,
        createdBy: {
          select: {
            instructorProfile: {
              select: { displayName: true, title: true, photoKey: true },
            },
          },
        },
      },
    });
    return rows.map((row) => ({
      courseId: row.id,
      profile: row.createdBy.instructorProfile,
    }));
  },

  /** Modules with their lessons, ordered, for the course detail page. */
  findModulesWithLessons(courseId: string) {
    return prisma.module.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        title: true,
        order: true,
        lessons: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            moduleId: true,
            courseId: true,
            title: true,
            description: true,
            durationSeconds: true,
            order: true,
            isPreview: true,
          },
        },
      },
    });
  },

  /** Lesson count + total duration per course, grouped in Postgres. */
  async aggregateLessons(courseIds: string[]): Promise<CourseAggregate[]> {
    if (courseIds.length === 0) return [];
    const grouped = await prisma.lesson.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds } },
      _count: { _all: true },
      _sum: { durationSeconds: true },
    });
    return grouped.map((row) => ({
      courseId: row.courseId,
      lessonCount: row._count._all,
      totalDuration: row._sum.durationSeconds ?? 0,
    }));
  },

  /**
   * Completed lessons per course for one learner.  Raw SQL because the count
   * needs a join from lesson_progress to lessons, which Prisma's `groupBy`
   * cannot express.
   */
  async completedLessonsByCourse(
    userId: string,
    courseIds: string[],
  ): Promise<CompletedAggregate[]> {
    if (courseIds.length === 0) return [];
    const rows = await prisma.$queryRaw<{ courseId: string; completed: bigint }[]>`
      SELECT l."courseId" AS "courseId", COUNT(*) AS "completed"
      FROM "lesson_progress" p
      JOIN "lessons" l ON l."id" = p."lessonId"
      WHERE p."userId" = ${userId}::uuid
        AND p."isCompleted" = TRUE
        AND l."courseId" = ANY(${courseIds}::uuid[])
      GROUP BY l."courseId"
    `;
    return rows.map((row) => ({ courseId: row.courseId, completed: Number(row.completed) }));
  },

  findEnrollmentsForCourses(userId: string, courseIds: string[]) {
    if (courseIds.length === 0) return Promise.resolve([]);
    return prisma.enrollment.findMany({
      where: { userId, courseId: { in: courseIds } },
    });
  },

  /** Distinct categories, for the catalog's filter chips. */
  async listCategories(): Promise<string[]> {
    const rows = await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    return rows.map((row) => row.category);
  },

  // --- writes ------------------------------------------------------------

  create(data: Prisma.CourseUncheckedCreateInput) {
    return prisma.course.create({ data, select: courseListSelect });
  },

  update(id: string, data: Prisma.CourseUpdateInput) {
    return prisma.course.update({ where: { id }, data, select: courseListSelect });
  },

  delete(id: string) {
    return prisma.course.delete({ where: { id } });
  },

  countEnrollments(courseId: string) {
    return prisma.enrollment.count({ where: { courseId } });
  },

  countLessons(courseId: string) {
    return prisma.lesson.count({ where: { courseId } });
  },

  findBySlug(slug: string) {
    return prisma.course.findUnique({ where: { slug }, select: { id: true } });
  },
};
