import type { Enrollment, EnrollmentQuery, EnrollmentWithCourse } from '@cadence/shared';
import { NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { buildCourseSummary, indexBy } from '../courses/courses.projection.js';
import { courseListSelect, coursesRepository } from '../courses/courses.repository.js';
import { courseProgressPercentage } from '../progress/progress.calculator.js';

/**
 * Enrollment.
 *
 * Enrolling is idempotent: the unique index on (userId, courseId) makes it so
 * at the database level, and the service reports which happened — 201 for a
 * new enrollment, 200 for one that already existed — so a double-clicked
 * button cannot create two rows or show an error.
 */

export type EnrollResult = { enrollment: Enrollment; created: boolean };

async function progressFor(userId: string, courseId: string) {
  const [totalLessons, completedLessons] = await Promise.all([
    prisma.lesson.count({ where: { courseId } }),
    prisma.lessonProgress.count({
      where: { userId, isCompleted: true, lesson: { courseId } },
    }),
  ]);
  return { totalLessons, completedLessons };
}

function toEnrollment(
  row: {
    id: string;
    userId: string;
    courseId: string;
    status: string;
    enrolledAt: Date;
    lastAccessedAt: Date | null;
    lastLessonId: string | null;
    completedAt: Date | null;
  },
  completedLessons: number,
  totalLessons: number,
): Enrollment {
  return {
    id: row.id,
    userId: row.userId,
    courseId: row.courseId,
    status: row.status as Enrollment['status'],
    enrolledAt: row.enrolledAt.toISOString(),
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    lastLessonId: row.lastLessonId,
    completedAt: row.completedAt?.toISOString() ?? null,
    progressPercentage: courseProgressPercentage(completedLessons, totalLessons),
    completedLessons,
    totalLessons,
  };
}

export const enrollmentService = {
  async enroll(userId: string, courseId: string): Promise<EnrollResult> {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, status: true, createdById: true },
    });
    if (!course) throw new NotFoundError('Course');

    /*
     * An author cannot enroll in their own course.
     *
     * Not a formality: an owner's enrollment would appear in their own
     * learner counts, drag their own completion rate around, and show up in
     * the enrolled-learners table as if they were a student. Preview exists
     * for exactly this, and it creates nothing.
     */
    if (course.createdById === userId) {
      throw new UnprocessableError(
        'You cannot enroll in your own course. Use Preview to see it as a learner would.',
      );
    }

    const existing = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (existing) {
      // Re-enrolling after cancelling reactivates the original row, so the
      // learner's progress comes back with it.
      if (existing.status === 'CANCELLED') {
        const revived = await prisma.enrollment.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE' },
        });
        const { totalLessons, completedLessons } = await progressFor(userId, courseId);
        return {
          enrollment: toEnrollment(revived, completedLessons, totalLessons),
          created: false,
        };
      }
      const { totalLessons, completedLessons } = await progressFor(userId, courseId);
      return {
        enrollment: toEnrollment(existing, completedLessons, totalLessons),
        created: false,
      };
    }

    // Only new enrollments are blocked by these rules; people already on an
    // archived course keep their access.
    if (course.status === 'ARCHIVED') {
      throw new UnprocessableError('This course has been archived and is no longer open');
    }
    if (course.status === 'DRAFT') {
      throw new NotFoundError('Course');
    }

    const totalLessons = await prisma.lesson.count({ where: { courseId } });
    if (totalLessons === 0) {
      throw new UnprocessableError('This course has no lessons yet');
    }

    const enrollment = await prisma.enrollment.create({
      data: { userId, courseId, status: 'ACTIVE' },
    });
    return { enrollment: toEnrollment(enrollment, 0, totalLessons), created: true };
  },

  async getForCourse(userId: string, courseId: string): Promise<Enrollment> {
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (!enrollment) throw new NotFoundError('Enrollment');
    const { totalLessons, completedLessons } = await progressFor(userId, courseId);
    return toEnrollment(enrollment, completedLessons, totalLessons);
  },

  /** The learner leaving a course.  Progress is kept, not deleted. */
  async cancel(userId: string, courseId: string): Promise<Enrollment> {
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (!enrollment) throw new NotFoundError('Enrollment');

    const updated = await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'CANCELLED' },
    });
    const { totalLessons, completedLessons } = await progressFor(userId, courseId);
    return toEnrollment(updated, completedLessons, totalLessons);
  },

  /** "My learning": the caller's enrollments with their courses attached. */
  async listMine(
    userId: string,
    query: EnrollmentQuery,
  ): Promise<{ items: EnrollmentWithCourse[]; meta: ReturnType<typeof buildMeta> }> {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const where = {
      userId,
      ...(query.status ? { status: query.status } : { status: { not: 'CANCELLED' as const } }),
    };

    const [rows, total] = await Promise.all([
      prisma.enrollment.findMany({
        where,
        orderBy: [{ lastAccessedAt: 'desc' }, { enrolledAt: 'desc' }],
        skip,
        take,
      }),
      prisma.enrollment.count({ where }),
    ]);

    const courseIds = rows.map((row) => row.courseId);
    const [courses, aggregates, completed] = await Promise.all([
      prisma.course.findMany({
        where: { id: { in: courseIds } },
        // The shared projection select, so a new course column cannot be
        // added in one place and forgotten here.
        select: courseListSelect,
      }),
      coursesRepository.aggregateLessons(courseIds),
      coursesRepository.completedLessonsByCourse(userId, courseIds),
    ]);

    const courseById = indexBy(courses, (row) => row.id);
    const aggregateById = indexBy(aggregates, (row) => row.courseId);
    const completedById = indexBy(completed, (row) => row.courseId);

    const items: EnrollmentWithCourse[] = [];
    for (const row of rows) {
      const course = courseById.get(row.courseId);
      if (!course) continue; // a course deleted under us; skip rather than 500
      const aggregate = aggregateById.get(row.courseId);
      const completedLessons = completedById.get(row.courseId)?.completed ?? 0;
      const lessonCount = aggregate?.lessonCount ?? 0;
      items.push({
        ...toEnrollment(row, completedLessons, lessonCount),
        course: buildCourseSummary({
          course,
          lessonCount,
          totalDuration: aggregate?.totalDuration ?? 0,
          enrollment: row,
          completedLessons,
        }),
      });
    }

    return { items, meta: buildMeta(query.page, query.pageSize, total) };
  },
};
