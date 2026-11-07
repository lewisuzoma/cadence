import type {
  LessonDetail,
  LessonInput,
  LessonSummary,
  LessonUpdateInput,
  ModuleInput,
  ModuleUpdateInput,
} from '@cadence/shared';
import type { LessonProgress } from '@prisma/client';
import { can } from '@cadence/shared';
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { assertOwnsCourse, isPlatformAdmin } from '../../lib/ownership.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthUser } from '../../middlewares/types.js';
import { buildLessonSummary, indexBy } from '../courses/courses.projection.js';

/**
 * Lessons and modules.
 *
 * Access rule for a single lesson, enforced here and nowhere else:
 *   an ACTIVE or COMPLETED enrollment  → full access
 *   the lesson is a preview on a PUBLISHED course → full access, untracked
 *   the caller is an ADMIN → full access
 *   otherwise → 403, or 404 when the course is a draft (so drafts stay hidden)
 */

export type LessonAccess = {
  canView: boolean;
  isTracked: boolean;
};

async function resolveAccess(
  lesson: { id: string; courseId: string; isPreview: boolean },
  user: AuthUser | undefined,
): Promise<LessonAccess> {
  const course = await prisma.course.findUnique({
    where: { id: lesson.courseId },
    select: { status: true, createdById: true },
  });
  if (!course) throw new NotFoundError('Course');

  /*
   * The owner and admins can watch any lesson of a course they manage, at
   * any status, and their viewing is never tracked.
   *
   * `isTracked: false` is what makes Preview truthful: the instructor can
   * watch their own course exactly as a learner would and no progress row,
   * no enrollment and no analytics data point comes of it.
   */
  const privileged =
    isPlatformAdmin(user) ||
    (!!user && course.createdById === user.id && can(user, 'course:manage-own'));
  if (privileged) return { canView: true, isTracked: false };

  // A draft's lessons must not be distinguishable from lessons that do not exist.
  if (course.status === 'DRAFT') throw new NotFoundError('Lesson');

  const enrollment = user
    ? await prisma.enrollment.findUnique({
        where: { userId_courseId: { userId: user.id, courseId: lesson.courseId } },
      })
    : null;

  const enrolled = !!enrollment && enrollment.status !== 'CANCELLED';
  if (enrolled) return { canView: true, isTracked: enrollment.status === 'ACTIVE' };

  // Previews are the catalog's shop window: viewable, never tracked.
  if (lesson.isPreview && course.status === 'PUBLISHED') {
    return { canView: true, isTracked: false };
  }

  throw new ForbiddenError('Enroll in this course to watch its lessons');
}

export const lessonsService = {
  /** The player payload, with sibling navigation across the whole course. */
  async getDetail(lessonId: string, user: AuthUser | undefined): Promise<LessonDetail> {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: { select: { id: true, title: true, order: true } },
        course: { select: { id: true, slug: true, title: true } },
      },
    });
    if (!lesson) throw new NotFoundError('Lesson');

    const access = await resolveAccess(lesson, user);

    // Course-wide ordering: module order first, then lesson order within it.
    const siblings = await prisma.lesson.findMany({
      where: { courseId: lesson.courseId },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
      select: { id: true },
    });
    const index = siblings.findIndex((row) => row.id === lesson.id);

    const progress = user
      ? await prisma.lessonProgress.findUnique({
          where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } },
        })
      : null;

    const summary = buildLessonSummary(lesson, progress ?? undefined, {
      canView: access.canView,
    });

    return {
      ...summary,
      videoUrl: lesson.videoUrl,
      captionsUrl: lesson.captionsUrl,
      module: lesson.module,
      course: lesson.course,
      previousLessonId: index > 0 ? siblings[index - 1]!.id : null,
      nextLessonId: index >= 0 && index < siblings.length - 1 ? siblings[index + 1]!.id : null,
      isTracked: access.isTracked,
    };
  },

  /** Flat lesson list for a course, used by the course page's sidebar. */
  async listForCourse(courseId: string, user: AuthUser | undefined): Promise<LessonSummary[]> {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, status: true, createdById: true },
    });
    if (!course) throw new NotFoundError('Course');
    const privileged =
      isPlatformAdmin(user) ||
      (!!user && course.createdById === user.id && can(user, 'course:manage-own'));
    if (course.status === 'DRAFT' && !privileged) throw new NotFoundError('Course');

    const enrollment = user
      ? await prisma.enrollment.findUnique({
          where: { userId_courseId: { userId: user.id, courseId } },
        })
      : null;
    const canView =
      privileged || (!!enrollment && enrollment.status !== 'CANCELLED');

    const [lessons, progressRows] = await Promise.all([
      prisma.lesson.findMany({
        where: { courseId },
        orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
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
      }),
      user
        ? prisma.lessonProgress.findMany({ where: { userId: user.id, lesson: { courseId } } })
        : Promise.resolve([] as LessonProgress[]),
    ]);

    const byLesson = indexBy(progressRows, (row) => row.lessonId);
    return lessons.map((lesson) =>
      buildLessonSummary(lesson, byLesson.get(lesson.id), { canView }),
    );
  },

  // --- authoring: modules ------------------------------------------------
  //
  // Each of these resolves the owning course first and asserts against it,
  // so a module or lesson id belonging to someone else answers 404 exactly
  // as the course itself would. Nothing downstream re-checks, because the
  // check has already happened here.

  async createModule(courseId: string, input: ModuleInput, actor: AuthUser) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, createdById: true },
    });
    assertOwnsCourse(course, actor);

    const order = input.order ?? (await nextModuleOrder(courseId));
    return prisma.module.create({
      data: { courseId, title: input.title, order },
      select: { id: true, courseId: true, title: true, order: true },
    });
  },

  async updateModule(moduleId: string, input: ModuleUpdateInput, actor: AuthUser) {
    const existing = await prisma.module.findUnique({
      where: { id: moduleId },
      include: { course: { select: { createdById: true } } },
    });
    if (!existing) throw new NotFoundError('Module');
    assertOwnsCourse(existing.course, actor, 'Module');

    if (input.order !== undefined && input.order !== existing.order) {
      const clash = await prisma.module.findFirst({
        where: { courseId: existing.courseId, order: input.order, id: { not: moduleId } },
        select: { id: true },
      });
      if (clash) throw new ConflictError('Another module already uses that position');
    }

    return prisma.module.update({
      where: { id: moduleId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
      },
      select: { id: true, courseId: true, title: true, order: true },
    });
  },

  /** Deleting a module cascades to its lessons, and so to their progress. */
  async deleteModule(moduleId: string, actor: AuthUser): Promise<void> {
    const existing = await prisma.module.findUnique({
      where: { id: moduleId },
      select: {
        id: true,
        courseId: true,
        course: { select: { createdById: true } },
      },
    });
    if (!existing) throw new NotFoundError('Module');
    assertOwnsCourse(existing.course, actor, 'Module');

    const watched = await prisma.lessonProgress.count({
      where: { lesson: { moduleId } },
    });
    if (watched > 0) {
      throw new ConflictError(
        'Learners have watched lessons in this module. Remove the lessons individually or archive the course instead.',
      );
    }
    await prisma.module.delete({ where: { id: moduleId } });
  },

  // --- authoring: lessons ------------------------------------------------

  async createLesson(moduleId: string, input: LessonInput, actor: AuthUser) {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      select: {
        id: true,
        courseId: true,
        course: { select: { createdById: true } },
      },
    });
    if (!module) throw new NotFoundError('Module');
    assertOwnsCourse(module.course, actor, 'Module');

    const order = input.order ?? (await nextLessonOrder(moduleId));
    const clash = await prisma.lesson.findFirst({
      where: { moduleId, order },
      select: { id: true },
    });
    if (clash) throw new ConflictError('Another lesson already uses that position');

    return prisma.lesson.create({
      data: {
        moduleId,
        // Denormalised, and only ever set from the module's own courseId.
        courseId: module.courseId,
        title: input.title,
        description: input.description,
        videoUrl: input.videoUrl,
        ...(input.captionsUrl ? { captionsUrl: input.captionsUrl } : {}),
        durationSeconds: input.durationSeconds,
        isPreview: input.isPreview,
        order,
      },
    });
  },

  async updateLesson(lessonId: string, input: LessonUpdateInput, actor: AuthUser) {
    const existing = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: { select: { createdById: true } } },
    });
    if (!existing) throw new NotFoundError('Lesson');
    assertOwnsCourse(existing.course, actor, 'Lesson');

    if (input.order !== undefined && input.order !== existing.order) {
      const clash = await prisma.lesson.findFirst({
        where: { moduleId: existing.moduleId, order: input.order, id: { not: lessonId } },
        select: { id: true },
      });
      if (clash) throw new ConflictError('Another lesson already uses that position');
    }

    return prisma.lesson.update({
      where: { id: lessonId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
        ...(input.captionsUrl !== undefined ? { captionsUrl: input.captionsUrl } : {}),
        ...(input.durationSeconds !== undefined
          ? { durationSeconds: input.durationSeconds }
          : {}),
        ...(input.isPreview !== undefined ? { isPreview: input.isPreview } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
      },
    });
  },

  async deleteLesson(lessonId: string, actor: AuthUser): Promise<void> {
    const existing = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, course: { select: { createdById: true } } },
    });
    if (!existing) throw new NotFoundError('Lesson');
    assertOwnsCourse(existing.course, actor, 'Lesson');
    // Progress rows cascade with the lesson; course percentages recompute from
    // whatever lessons remain, so no stored total goes stale.
    await prisma.lesson.delete({ where: { id: lessonId } });
  },

  /**
   * Reorders every lesson in a module, in one transaction.
   *
   * Progress is keyed by lessonId, never by position, so reordering can never
   * move a learner's completion onto a different lesson.  The two-pass write
   * (park on negative orders, then set the final ones) exists because
   * `@@unique([moduleId, order])` would otherwise trip mid-update.
   */
  async reorderLessons(
    moduleId: string,
    lessonIds: string[],
    actor: AuthUser,
  ): Promise<LessonSummary[]> {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, course: { select: { createdById: true } } },
    });
    if (!module) throw new NotFoundError('Module');
    assertOwnsCourse(module.course, actor, 'Module');

    const lessons = await prisma.lesson.findMany({
      where: { moduleId },
      select: { id: true },
    });
    if (lessons.length === 0) throw new NotFoundError('Module');

    const existingIds = new Set(lessons.map((row) => row.id));
    const incoming = new Set(lessonIds);
    if (incoming.size !== lessonIds.length) {
      throw new UnprocessableError('The same lesson appeared twice in the new order');
    }
    if (lessonIds.length !== lessons.length || lessonIds.some((id) => !existingIds.has(id))) {
      throw new UnprocessableError(
        'Send every lesson in this module exactly once when reordering',
      );
    }

    await prisma.$transaction(async (tx) => {
      await Promise.all(
        lessonIds.map((id, index) =>
          tx.lesson.update({ where: { id }, data: { order: -(index + 1) } }),
        ),
      );
      await Promise.all(
        lessonIds.map((id, index) =>
          tx.lesson.update({ where: { id }, data: { order: index + 1 } }),
        ),
      );
    });

    const reordered = await prisma.lesson.findMany({
      where: { moduleId },
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
    });
    return reordered.map((lesson) =>
      buildLessonSummary(lesson, undefined, { canView: true }),
    );
  },
};

async function nextModuleOrder(courseId: string): Promise<number> {
  const last = await prisma.module.findFirst({
    where: { courseId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });
  return (last?.order ?? 0) + 1;
}

async function nextLessonOrder(moduleId: string): Promise<number> {
  const last = await prisma.lesson.findFirst({
    where: { moduleId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });
  return (last?.order ?? 0) + 1;
}
