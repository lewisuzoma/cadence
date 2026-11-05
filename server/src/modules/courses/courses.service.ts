import type {
  AdminCourseQuery,
  CourseDetail,
  CourseInput,
  CourseQuery,
  CourseStatus,
  CourseSummary,
  CourseUpdateInput,
  ModuleWithLessons,
} from '@cadence/shared';
import type { Enrollment, LessonProgress } from '@prisma/client';
import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { isUuid, uniqueCourseSlug } from '../../lib/slug.js';
import type { AuthUser } from '../../middlewares/types.js';
import {
  buildCourseSummary,
  buildLessonSummary,
  indexBy,
} from './courses.projection.js';
import { coursesRepository, type CourseListRow } from './courses.repository.js';

/**
 * Course business rules.
 *
 * Visibility is decided here, once:
 *  - learners and anonymous visitors see PUBLISHED courses only
 *  - a DRAFT course answers 404 rather than 403, so an unreleased title is
 *    not disclosed by the status code
 *  - ARCHIVED courses leave the catalog but stay readable for people already
 *    enrolled
 */

type ListResult = { items: CourseSummary[]; meta: ReturnType<typeof buildMeta> };

/** Attaches lesson aggregates (and the caller's progress) to course rows. */
async function decorate(rows: CourseListRow[], userId?: string): Promise<CourseSummary[]> {
  const ids = rows.map((row) => row.id);
  const [aggregates, enrollments, completed] = await Promise.all([
    coursesRepository.aggregateLessons(ids),
    userId ? coursesRepository.findEnrollmentsForCourses(userId, ids) : Promise.resolve([]),
    userId ? coursesRepository.completedLessonsByCourse(userId, ids) : Promise.resolve([]),
  ]);

  const aggregateByCourse = indexBy(aggregates, (row) => row.courseId);
  const enrollmentByCourse = indexBy(enrollments as Enrollment[], (row) => row.courseId);
  const completedByCourse = indexBy(completed, (row) => row.courseId);

  return rows.map((course) => {
    const aggregate = aggregateByCourse.get(course.id);
    return buildCourseSummary({
      course,
      lessonCount: aggregate?.lessonCount ?? 0,
      totalDuration: aggregate?.totalDuration ?? 0,
      enrollment: enrollmentByCourse.get(course.id),
      completedLessons: completedByCourse.get(course.id)?.completed ?? 0,
    });
  });
}

export const coursesService = {
  async listPublished(query: CourseQuery, userId?: string): Promise<ListResult> {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const { rows, total } = await coursesRepository.listPublished({
      skip,
      take,
      search: query.search,
      category: query.category,
      difficulty: query.difficulty ? { equals: query.difficulty } : undefined,
      sort: query.sort,
    });

    const items = await decorate(rows, userId);
    // `duration` is a derived column, so this page is ordered after decoration.
    if (query.sort === 'duration') {
      items.sort((a, b) => b.estimatedDuration - a.estimatedDuration);
    }
    return { items, meta: buildMeta(query.page, query.pageSize, total) };
  },

  async listForAdmin(query: AdminCourseQuery): Promise<ListResult> {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const { rows, total } = await coursesRepository.listAll({
      skip,
      take,
      search: query.search,
      category: query.category,
      status: query.status ? { equals: query.status } : undefined,
      difficulty: query.difficulty ? { equals: query.difficulty } : undefined,
      sort: query.sort,
    });
    const items = await decorate(rows);
    return { items, meta: buildMeta(query.page, query.pageSize, total) };
  },

  listCategories(): Promise<string[]> {
    return coursesRepository.listCategories();
  },

  /**
   * Course detail, including the module → lesson tree and the caller's
   * per-lesson progress.
   */
  async getDetail(idOrSlug: string, user?: AuthUser): Promise<CourseDetail> {
    const course = await coursesRepository.findByIdOrSlug(idOrSlug, isUuid(idOrSlug));
    if (!course) throw new NotFoundError('Course');

    const isAdmin = user?.role === 'ADMIN';
    // Drafts are invisible to everyone but an admin, and answer 404.
    if (!isAdmin && course.status === 'DRAFT') throw new NotFoundError('Course');

    const enrollment = user
      ? await prisma.enrollment.findUnique({
          where: { userId_courseId: { userId: user.id, courseId: course.id } },
        })
      : null;

    // An archived course stays open to people already enrolled (and admins),
    // but is otherwise gone.
    if (!isAdmin && course.status === 'ARCHIVED' && !enrollment) {
      throw new NotFoundError('Course');
    }

    const [modules, aggregates, progressRows] = await Promise.all([
      coursesRepository.findModulesWithLessons(course.id),
      coursesRepository.aggregateLessons([course.id]),
      user
        ? prisma.lessonProgress.findMany({
            where: { userId: user.id, lesson: { courseId: course.id } },
          })
        : Promise.resolve([] as LessonProgress[]),
    ]);

    const progressByLesson = indexBy(progressRows, (row) => row.lessonId);
    const canView = isAdmin || (!!enrollment && enrollment.status !== 'CANCELLED');
    const completedLessons = progressRows.filter((row) => row.isCompleted).length;
    const aggregate = aggregates[0];

    const projectedModules: ModuleWithLessons[] = modules.map((module) => ({
      id: module.id,
      title: module.title,
      order: module.order,
      lessons: module.lessons.map((lesson) =>
        buildLessonSummary(lesson, progressByLesson.get(lesson.id), { canView }),
      ),
    }));

    const summary = buildCourseSummary({
      course,
      lessonCount: aggregate?.lessonCount ?? 0,
      totalDuration: aggregate?.totalDuration ?? 0,
      enrollment: enrollment ?? undefined,
      completedLessons,
    });

    return {
      ...summary,
      modules: projectedModules,
      createdBy: course.createdBy
        ? {
            id: course.createdBy.id,
            firstName: course.createdBy.firstName,
            lastName: course.createdBy.lastName,
          }
        : null,
    };
  },

  /** Admins see any course by id, whatever its status. */
  async getForAdmin(id: string): Promise<CourseDetail> {
    const course = await coursesRepository.findById(id);
    if (!course) throw new NotFoundError('Course');
    return this.getDetail(id, {
      id: course.createdById,
      role: 'ADMIN',
      email: '',
      firstName: '',
      lastName: '',
      isActive: true,
    });
  },

  async create(input: CourseInput, adminId: string): Promise<CourseSummary> {
    const slug = input.slug
      ? await (async () => {
          const taken = await coursesRepository.findBySlug(input.slug!);
          if (taken) throw new ConflictError('That slug is already in use');
          return input.slug!;
        })()
      : await uniqueCourseSlug(input.title);

    const course = await coursesRepository.create({
      title: input.title,
      slug,
      description: input.description,
      category: input.category,
      thumbnailUrl: input.thumbnailUrl,
      difficulty: input.difficulty,
      createdById: adminId,
      // New courses always start as drafts: publishing is an explicit act.
      status: 'DRAFT',
    });

    return buildCourseSummary({ course, lessonCount: 0, totalDuration: 0 });
  },

  async update(id: string, input: CourseUpdateInput): Promise<CourseSummary> {
    const existing = await coursesRepository.findById(id);
    if (!existing) throw new NotFoundError('Course');

    // Retitling does not change a live slug: inbound links must keep working.
    let slug = existing.slug;
    if (input.slug && input.slug !== existing.slug) {
      const taken = await coursesRepository.findBySlug(input.slug);
      if (taken && taken.id !== id) throw new ConflictError('That slug is already in use');
      slug = input.slug;
    }

    const course = await coursesRepository.update(id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.thumbnailUrl !== undefined ? { thumbnailUrl: input.thumbnailUrl } : {}),
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      slug,
    });

    const [aggregate] = await coursesRepository.aggregateLessons([id]);
    return buildCourseSummary({
      course,
      lessonCount: aggregate?.lessonCount ?? 0,
      totalDuration: aggregate?.totalDuration ?? 0,
    });
  },

  /**
   * Status transitions.
   *  - publishing an empty course is a 422: a learner could enroll and find
   *    nothing to watch
   *  - `publishedAt` is stamped once, on the first publish, so re-publishing
   *    after an unpublish does not rewrite history
   */
  async setStatus(id: string, status: CourseStatus): Promise<CourseSummary> {
    const existing = await coursesRepository.findById(id);
    if (!existing) throw new NotFoundError('Course');

    if (status === 'PUBLISHED') {
      const lessonCount = await coursesRepository.countLessons(id);
      if (lessonCount === 0) {
        throw new UnprocessableError('Add at least one lesson before publishing this course');
      }
    }

    const course = await coursesRepository.update(id, {
      status,
      ...(status === 'PUBLISHED' && !existing.publishedAt ? { publishedAt: new Date() } : {}),
    });

    const [aggregate] = await coursesRepository.aggregateLessons([id]);
    return buildCourseSummary({
      course,
      lessonCount: aggregate?.lessonCount ?? 0,
      totalDuration: aggregate?.totalDuration ?? 0,
    });
  },

  /**
   * Deleting a course with learners on it would destroy their progress, so it
   * is a 409 that tells the admin to archive instead.
   */
  async remove(id: string): Promise<void> {
    const existing = await coursesRepository.findById(id);
    if (!existing) throw new NotFoundError('Course');

    const enrollments = await coursesRepository.countEnrollments(id);
    if (enrollments > 0) {
      throw new ConflictError(
        `This course has ${enrollments} enrolled learner${enrollments === 1 ? '' : 's'}. Archive it instead to keep their progress.`,
      );
    }
    await coursesRepository.delete(id);
  },
};
