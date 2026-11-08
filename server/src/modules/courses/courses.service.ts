import type {
  AdminCourseQuery,
  CourseDetail,
  CourseInput,
  CourseQuery,
  CourseStatus,
  CourseSummary,
  CoursePreview,
  CourseDraftState,
  CourseUpdateInput,
  LessonSummary,
  ModuleWithLessons,
  PublishCheck,
  PublishChecklist,
} from '@cadence/shared';
import type { Enrollment, LessonProgress } from '@prisma/client';
import { can } from '@cadence/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PublishBlockedError,
} from '../../lib/errors.js';
import { assertOwnsCourse, isPlatformAdmin } from '../../lib/ownership.js';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { isUuid, uniqueCourseSlug } from '../../lib/slug.js';
import type { AuthUser } from '../../middlewares/types.js';
import { mediaUrlForKey } from '../../lib/media-url.js';
import { courseVersions, type LiveCourseContent } from './courses.versions.js';
import { notifyArchivedLearners } from '../lessons/lessons.recalculate.js';
import { notificationsService } from '../notifications/notifications.service.js';
import {
  buildCourseSummary,
  buildLessonSummary,
  buildPublicInstructor,
  indexBy,
  isPlayableVideoUrl,
} from './courses.projection.js';
import {
  courseListSelect,
  coursesRepository,
  type CourseListRow,
} from './courses.repository.js';
import type { LessonRowForProjection } from './courses.projection.js';

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
/**
 * Turns course rows into catalog cards.
 *
 * `published: true` makes the card show the **live version** rather than
 * the instructor's draft — so an instructor rewriting a title does not
 * change what the catalogue says until they publish. The management
 * views pass `false` and see their own work in progress.
 */
async function decorate(
  rows: CourseListRow[],
  userId?: string,
  options: { published?: boolean } = {},
): Promise<CourseSummary[]> {
  const ids = rows.map((row) => row.id);
  const [aggregates, enrollments, completed, instructors, liveContent] = await Promise.all([
    coursesRepository.aggregateLessons(ids),
    userId ? coursesRepository.findEnrollmentsForCourses(userId, ids) : Promise.resolve([]),
    userId ? coursesRepository.completedLessonsByCourse(userId, ids) : Promise.resolve([]),
    coursesRepository.publicInstructorsForCourses(ids),
    options.published
      ? courseVersions.liveForCourses(ids)
      : Promise.resolve(new Map<string, LiveCourseContent>()),
  ]);

  const aggregateByCourse = indexBy(aggregates, (row) => row.courseId);
  const enrollmentByCourse = indexBy(enrollments as Enrollment[], (row) => row.courseId);
  const completedByCourse = indexBy(completed, (row) => row.courseId);
  const instructorByCourse = indexBy(instructors, (row) => row.courseId);

  return rows.map((course) => {
    const aggregate = aggregateByCourse.get(course.id);
    const live = liveContent.get(course.id);

    return buildCourseSummary({
      // The published presentation wins where there is one; the draft's
      // row is the fallback for the management views and for a course
      // that has never been published.
      course: live ? { ...course, ...liveOverlay(live) } : course,
      lessonCount: live ? live.lessons.length : (aggregate?.lessonCount ?? 0),
      totalDuration: live
        ? live.lessons.reduce((sum, lesson) => sum + lesson.durationSeconds, 0)
        : (aggregate?.totalDuration ?? 0),
      enrollment: enrollmentByCourse.get(course.id),
      completedLessons: completedByCourse.get(course.id)?.completed ?? 0,
      instructor: buildPublicInstructor(
        instructorByCourse.get(course.id)?.profile,
        mediaUrlForKey(instructorByCourse.get(course.id)?.profile?.photoKey),
      ),
    });
  });
}

/**
 * Regroups a published version's flat lesson list back into modules.
 *
 * A lesson whose row has since been deleted is skipped: the snapshot row
 * cascades with it, but a concurrent delete between the two reads would
 * otherwise leave a lesson in the list that cannot be played.
 */
function groupVersionLessons(
  live: LiveCourseContent,
  draftLessonsById: Map<string, LessonRowForProjection>,
  progressByLesson: Map<string, LessonProgress>,
  canView: boolean,
): ModuleWithLessons[] {
  const byModule = new Map<number, { title: string; lessons: LessonSummary[] }>();

  for (const snapshot of live.lessons) {
    const row = draftLessonsById.get(snapshot.lessonId);
    if (!row) continue;

    const group = byModule.get(snapshot.moduleOrder) ?? {
      title: snapshot.moduleTitle,
      lessons: [],
    };

    group.lessons.push(
      buildLessonSummary(
        {
          // The snapshot's presentation, over the live row's identity and
          // its video — so a retitled lesson keeps its progress.
          ...row,
          title: snapshot.title,
          description: snapshot.description,
          durationSeconds: snapshot.durationSeconds,
          order: snapshot.order,
          isPreview: snapshot.isPreview,
        },
        progressByLesson.get(snapshot.lessonId),
        { canView },
      ),
    );
    byModule.set(snapshot.moduleOrder, group);
  }

  return [...byModule.entries()]
    .sort(([a], [b]) => a - b)
    .map(([order, group]) => ({
      // Versions have no module ids of their own; the order is the
      // stable key within a published curriculum.
      id: `v${live.version}-m${order}`,
      title: group.title,
      order,
      lessons: group.lessons,
    }));
}

/** The fields a published version overrides on the draft row. */
function liveOverlay(live: LiveCourseContent) {
  return {
    title: live.title,
    shortDescription: live.shortDescription,
    description: live.description,
    category: live.category,
    difficulty: live.difficulty,
    thumbnailUrl: live.thumbnailUrl,
    learningObjectives: live.learningObjectives,
    prerequisites: live.prerequisites,
    targetAudience: live.targetAudience,
  };
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

    const items = await decorate(rows, userId, { published: true });
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

    /*
     * Who may see a course outside the catalogue: an admin, or the
     * instructor who owns it.  Asking `can(...)` rather than comparing the
     * role is what keeps an approved instructor's learner view intact — they
     * are still an ordinary learner on everyone else's courses.
     */
    const isAdmin = can(user, 'course:manage-any');
    const isOwner = !!user && course.createdById === user.id && can(user, 'course:manage-own');
    const privileged = isAdmin || isOwner;

    // Drafts are invisible to everyone else, and answer 404 rather than 403.
    if (!privileged && course.status === 'DRAFT') throw new NotFoundError('Course');

    const enrollment = user
      ? await prisma.enrollment.findUnique({
          where: { userId_courseId: { userId: user.id, courseId: course.id } },
        })
      : null;

    // An archived course stays open to people already enrolled (and to the
    // owner and admins), but is otherwise gone.
    if (!privileged && course.status === 'ARCHIVED' && !enrollment) {
      throw new NotFoundError('Course');
    }

    /*
     * Which curriculum to show.
     *
     * A learner sees the **published version**: the instructor may be
     * halfway through adding three lessons, and those must not appear in
     * someone's course page before they are published. The owner and
     * admins see the live draft, because that is what they are editing.
     */
    const [modules, aggregates, progressRows, instructors, live] = await Promise.all([
      coursesRepository.findModulesWithLessons(course.id),
      coursesRepository.aggregateLessons([course.id]),
      user
        ? prisma.lessonProgress.findMany({
            where: { userId: user.id, lesson: { courseId: course.id } },
          })
        : Promise.resolve([] as LessonProgress[]),
      coursesRepository.publicInstructorsForCourses([course.id]),
      privileged ? Promise.resolve(null) : courseVersions.live(course.id),
    ]);

    const progressByLesson = indexBy(progressRows, (row) => row.lessonId);
    const canView = privileged || (!!enrollment && enrollment.status !== 'CANCELLED');
    const completedLessons = progressRows.filter((row) => row.isCompleted).length;
    const aggregate = aggregates[0];

    /*
     * The draft's module tree, or the published snapshot's.
     *
     * The snapshot stores its grouping flat — a version records the
     * module a lesson *was* in, because modules are editable too — so it
     * is regrouped here into the same shape the draft produces. The
     * lesson rows themselves are looked up live by id, because that is
     * what carries the video and what progress is keyed to.
     */
    const draftLessonsById = new Map(
      modules.flatMap((module) => module.lessons).map((lesson) => [lesson.id, lesson]),
    );

    const projectedModules: ModuleWithLessons[] = live
      ? groupVersionLessons(live, draftLessonsById, progressByLesson, canView)
      : modules.map((module) => ({
          id: module.id,
          title: module.title,
          order: module.order,
          lessons: module.lessons.map((lesson) =>
            buildLessonSummary(lesson, progressByLesson.get(lesson.id), { canView }),
          ),
        }));

    const instructorProfile = instructors[0]?.profile;
    const liveLessonCount = live?.lessons.length ?? 0;
    const liveDuration =
      live?.lessons.reduce((sum, lesson) => sum + lesson.durationSeconds, 0) ?? 0;

    const summary = buildCourseSummary({
      course: live ? { ...course, ...liveOverlay(live) } : course,
      lessonCount: live ? liveLessonCount : (aggregate?.lessonCount ?? 0),
      totalDuration: live ? liveDuration : (aggregate?.totalDuration ?? 0),
      enrollment: enrollment ?? undefined,
      completedLessons,
      instructor: buildPublicInstructor(
        instructorProfile,
        mediaUrlForKey(instructorProfile?.photoKey),
      ),
    });

    return {
      ...summary,
      modules: projectedModules,
      learningObjectives: live ? live.learningObjectives : course.learningObjectives,
      prerequisites: live ? live.prerequisites : course.prerequisites,
      targetAudience: live ? live.targetAudience : course.targetAudience,
      createdBy: course.createdBy
        ? {
            id: course.createdBy.id,
            firstName: course.createdBy.firstName,
            lastName: course.createdBy.lastName,
          }
        : null,
    };
  },

  /**
   * The management view of a single course: any status, full module tree.
   *
   * Scoped by ownership rather than by role, so the same method serves the
   * admin editor and the instructor editor.  Another instructor's course is
   * a 404 here, which is what stops the instructor workspace from being used
   * to enumerate the catalogue of unpublished work.
   */
  async getForManagement(id: string, actor: AuthUser): Promise<CourseDetail> {
    const course = await coursesRepository.findById(id);
    assertOwnsCourse(course, actor);
    return this.getDetail(id, actor);
  },

  /**
   * Creates a course owned by the acting user.
   *
   * The owner comes from the session and from nowhere else: there is no
   * `ownerId` or `instructorId` in `CourseInput`, so a client cannot create a
   * course in someone else's name however it shapes the body.
   */
  async create(input: CourseInput, actor: AuthUser): Promise<CourseSummary> {
    const slug = input.slug
      ? await (async () => {
          const taken = await coursesRepository.findBySlug(input.slug!);
          if (taken) throw new ConflictError('That slug is already in use');
          return input.slug!;
        })()
      : await uniqueCourseSlug(input.title);

    const course = await prisma.$transaction(async (tx) => {
      const created = await tx.course.create({
        data: {
          title: input.title,
          slug,
          description: input.description,
          shortDescription: input.shortDescription ?? '',
          category: input.category,
          thumbnailUrl: input.thumbnailUrl,
          difficulty: input.difficulty,
          learningObjectives: input.learningObjectives ?? [],
          prerequisites: input.prerequisites ?? [],
          targetAudience: input.targetAudience ?? '',
          ...(input.thumbnailAssetId ? { thumbnailAssetId: input.thumbnailAssetId } : {}),
          createdById: actor.id,
          // New courses always start as drafts: publishing is an explicit act.
          status: 'DRAFT',
        },
        select: courseListSelect,
      });
      // The activity feed reads events, not inferred timestamps, so the
      // course's first event is written with it in the same transaction.
      await tx.courseEvent.create({
        data: { courseId: created.id, actorId: actor.id, type: 'CREATED' },
      });
      return created;
    });

    return buildCourseSummary({ course, lessonCount: 0, totalDuration: 0 });
  },

  async update(
    id: string,
    input: CourseUpdateInput,
    actor: AuthUser,
  ): Promise<CourseSummary> {
    const existing = await coursesRepository.findById(id);
    assertOwnsCourse(existing, actor);

    /*
     * A suspended instructor can still read their courses but cannot change
     * them.  The route guard says the same thing; repeating it here means the
     * rule holds for any future caller of this service too.
     */
    assertCanEdit(actor);

    // Retitling does not change a live slug: inbound links must keep working.
    let slug = existing.slug;
    if (input.slug && input.slug !== existing.slug) {
      const taken = await coursesRepository.findBySlug(input.slug);
      if (taken && taken.id !== id) throw new ConflictError('That slug is already in use');
      slug = input.slug;
    }

    /*
     * Fields are copied across one by one rather than spread from the body.
     * `ownerId`, `createdById`, `status` and `role` are therefore
     * unassignable through this path no matter what the client sends:
     * changing ownership or publishing is a separate, guarded operation.
     */
    const course = await coursesRepository.update(id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.shortDescription !== undefined
        ? { shortDescription: input.shortDescription }
        : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.thumbnailUrl !== undefined ? { thumbnailUrl: input.thumbnailUrl } : {}),
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      ...(input.learningObjectives !== undefined
        ? { learningObjectives: input.learningObjectives }
        : {}),
      ...(input.prerequisites !== undefined ? { prerequisites: input.prerequisites } : {}),
      ...(input.targetAudience !== undefined ? { targetAudience: input.targetAudience } : {}),
      ...(input.thumbnailAssetId !== undefined
        ? {
            thumbnailAsset: input.thumbnailAssetId
              ? { connect: { id: input.thumbnailAssetId } }
              : { disconnect: true },
          }
        : {}),
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
   * The course exactly as a learner would see it, for its owner or an admin.
   *
   * Three properties make this a real preview rather than a different page:
   *
   *  - it works at any status, so a draft can be reviewed before publishing;
   *  - it needs no enrollment, and creates none;
   *  - **nothing watched here is recorded.** `lessonsService.resolveAccess`
   *    returns `isTracked: false` for the owner, so the player writes no
   *    progress rows and the course's own analytics stay clean of its
   *    author's viewing.
   *
   * It reuses `getDetail` rather than assembling a parallel payload, which
   * is what guarantees the preview and the learner view cannot diverge.
   */
  async preview(id: string, actor: AuthUser): Promise<CoursePreview> {
    const course = await coursesRepository.findById(id);
    assertOwnsCourse(course, actor);

    const detail = await this.getDetail(id, actor);
    return {
      ...detail,
      preview: {
        isPreview: true,
        courseStatus: course.status,
        // The banner's second line: "Draft · not in catalog".
        inCatalog: course.status === 'PUBLISHED',
        progressTracked: false,
      },
    };
  },

  /**
   * How the draft differs from what learners see.
   *
   * The editor's "unpublished changes" banner and the version history
   * both read this, so the instructor can tell at a glance whether the
   * course they are looking at is the one the world has.
   */
  async draftState(id: string, actor: AuthUser): Promise<CourseDraftState> {
    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, createdById: true, liveVersionId: true },
    });
    assertOwnsCourse(course, actor);

    const [pendingChanges, history] = await Promise.all([
      courseVersions.pendingChanges(id),
      courseVersions.history(id),
    ]);
    const liveEntry = history.find((entry) => entry.isLive);

    return {
      courseId: id,
      liveVersion: liveEntry?.version ?? null,
      livePublishedAt: liveEntry?.publishedAt ?? null,
      hasUnpublishedChanges: pendingChanges.length > 0,
      pendingChanges,
      history,
    };
  },

  /**
   * Evaluates every publishing rule and reports all of them.
   *
   * Deliberately not fail-fast: the editor shows this as a checklist, and an
   * author who fixes one problem only to be told about the next one is being
   * made to do the work the server could have done in a single pass.
   */
  async publishChecklist(id: string, actor: AuthUser): Promise<PublishChecklist> {
    const course = await prisma.course.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        shortDescription: true,
        category: true,
        thumbnailUrl: true,
        createdById: true,
      },
    });
    assertOwnsCourse(course, actor);

    const [lessons, owner] = await Promise.all([
      prisma.lesson.findMany({
        where: { courseId: id },
        select: {
          id: true,
          title: true,
          durationSeconds: true,
          videoUrl: true,
          videoAsset: { select: { status: true } },
        },
      }),
      prisma.user.findUnique({
        where: { id: course.createdById },
        select: { instructorProfile: { select: { status: true } } },
      }),
    ]);

    /** A lesson is playable with a READY upload or a usable URL. */
    const isPlayable = (lesson: (typeof lessons)[number]): boolean =>
      lesson.videoAsset
        ? lesson.videoAsset.status === 'READY'
        : isPlayableVideoUrl(lesson.videoUrl);

    const withoutVideo = lessons.filter((lesson) => !isPlayable(lesson));
    const withoutDuration = lessons.filter((lesson) => lesson.durationSeconds <= 0);
    const untitled = lessons.filter((lesson) => lesson.title.trim().length === 0);

    const checks: PublishCheck[] = [
      {
        id: 'title',
        label: 'Title (6+ characters)',
        passed: course.title.trim().length >= 6,
        detail: 'Give the course a title of at least 6 characters.',
      },
      {
        id: 'descriptions',
        label: 'Short and full descriptions',
        passed:
          course.shortDescription.trim().length > 0 && course.description.trim().length >= 80,
        detail:
          'Add a one-sentence short description and a full description of 80+ characters.',
      },
      {
        id: 'category',
        label: 'Category selected',
        passed: course.category.trim().length > 0,
        detail: 'Choose a category so the course can be found in the catalog.',
      },
      {
        id: 'thumbnail',
        label: 'Thumbnail uploaded',
        passed: course.thumbnailUrl.trim().length > 0,
        detail: 'Add a 16:9 thumbnail.',
      },
      {
        id: 'has-lessons',
        label:
          lessons.length > 0
            ? `At least one lesson (${lessons.length} added)`
            : 'At least one lesson',
        passed: lessons.length > 0,
        detail: 'A course with no lessons would leave a learner with nothing to watch.',
      },
      {
        id: 'lesson-videos',
        label: 'Every lesson has a playable video',
        passed: lessons.length > 0 && withoutVideo.length === 0,
        detail:
          withoutVideo.length > 0
            ? `${withoutVideo.length} lesson${withoutVideo.length === 1 ? '' : 's'} need a video`
            : 'Each lesson needs a finished upload or a valid https:// URL.',
        lessonIds: withoutVideo.map((lesson) => lesson.id),
      },
      {
        id: 'lesson-durations',
        label: 'Every lesson has a duration above 0',
        passed: lessons.length > 0 && withoutDuration.length === 0 && untitled.length === 0,
        detail:
          'Completion is measured against the duration, so every lesson needs a title and a duration above zero.',
        lessonIds: [...withoutDuration, ...untitled].map((lesson) => lesson.id),
      },
      {
        id: 'owner-active',
        label: 'Instructor access is active',
        passed: owner?.instructorProfile?.status !== 'SUSPENDED',
        detail: 'A suspended instructor cannot publish. Contact support to resolve it.',
      },
    ];

    return {
      courseId: id,
      checks,
      passing: checks.filter((check) => check.passed).length,
      total: checks.length,
      canPublish: checks.every((check) => check.passed),
    };
  },

  /**
   * Status transitions.
   *
   *  - publishing runs the full checklist and answers 422 with *every*
   *    failing rule, so the editor can render it rather than guess
   *  - `publishedAt` is stamped once, on the first publish, so re-publishing
   *    after an unpublish does not rewrite history
   *  - unpublishing and archiving never touch enrollments or progress: they
   *    change who can *find* the course, not who already has it
   */
  async setStatus(
    id: string,
    status: CourseStatus,
    actor: AuthUser,
    changeSummary?: string,
  ): Promise<CourseSummary> {
    const existing = await coursesRepository.findById(id);
    assertOwnsCourse(existing, actor);
    assertCanEdit(actor);

    if (status === 'PUBLISHED') {
      const checklist = await this.publishChecklist(id, actor);
      if (!checklist.canPublish) throw new PublishBlockedError(checklist);
    }

    const course = await prisma.$transaction(async (tx) => {
      /*
       * Publishing freezes the draft as a new version, and that is what
       * learners then see. Re-publishing an already-live course is the
       * same operation: it is how an instructor ships the edits they
       * have been making without anyone watching the course noticing
       * until they decide.
       */
      if (status === 'PUBLISHED') {
        await courseVersions.publish(tx, {
          courseId: id,
          actorId: actor.id,
          ...(changeSummary ? { changeSummary } : {}),
        });
      }

      const updated = await tx.course.update({
        where: { id },
        data: {
          status,
          ...(status === 'PUBLISHED' && !existing.publishedAt
            ? { publishedAt: new Date() }
            : {}),
        },
        select: courseListSelect,
      });

      if (status !== existing.status) {
        await tx.courseEvent.create({
          data: {
            courseId: id,
            actorId: actor.id,
            type:
              status === 'PUBLISHED'
                ? 'PUBLISHED'
                : status === 'ARCHIVED'
                  ? 'ARCHIVED'
                  : 'UNPUBLISHED',
          },
        });

        /*
         * The owner is told what happened to their course, in the same
         * transaction as the change itself — so a rolled-back publish
         * never leaves a notification claiming the course is live.
         *
         * Sent even when the owner made the change themselves. That looks
         * redundant and is not: the artifact's own notification list shows
         * "Course unpublished — moved back to drafts" for a self-triggered
         * change, because the list doubles as a record of what happened to
         * a course and when. An admin acting on someone else's course is
         * the case where it is obviously necessary.
         */
        {
          await notificationsService.notify(
            [
              {
                userId: existing.createdById,
                type:
                  status === 'PUBLISHED'
                    ? 'COURSE_PUBLISHED'
                    : status === 'ARCHIVED'
                      ? 'COURSE_ARCHIVED'
                      : 'COURSE_UNPUBLISHED',
                title:
                  status === 'PUBLISHED'
                    ? 'Course published'
                    : status === 'ARCHIVED'
                      ? 'Course archived'
                      : 'Course unpublished',
                body:
                  status === 'PUBLISHED'
                    ? `"${updated.title}" is live in the catalog.`
                    : status === 'ARCHIVED'
                      ? `"${updated.title}" has been archived. Enrolled learners keep access.`
                      : `"${updated.title}" moved back to drafts.`,
                link: `/instructor/courses/${id}`,
              },
            ],
            tx,
          );
        }

        /*
         * Archiving is the one status change a *learner* needs to hear
         * about: the course leaves the catalog, and someone part-way
         * through it should be told their access is unaffected rather
         * than discovering the course has vanished from search.
         */
        if (status === 'ARCHIVED') {
          await notifyArchivedLearners(tx, {
            courseId: id,
            courseTitle: updated.title,
            courseSlug: updated.slug,
          });
        }
      }
      return updated;
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
   * is a 409 that tells the owner to archive instead.
   */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const existing = await coursesRepository.findById(id);
    assertOwnsCourse(existing, actor);
    assertCanEdit(actor);

    const enrollments = await coursesRepository.countEnrollments(id);
    if (enrollments > 0) {
      throw new ConflictError(
        `This course has ${enrollments} enrolled learner${enrollments === 1 ? '' : 's'}. Archive it instead to keep their progress.`,
      );
    }
    await coursesRepository.delete(id);
  },
};

/**
 * A suspended instructor keeps read access to their workspace — they can see
 * what is there and why it is paused — but every write is refused.
 *
 * 403 and not 404: the course is theirs and they know it exists, so hiding it
 * would only be confusing. This is the one instructor-facing case where the
 * reason is safe to state, and the UI has a page for exactly it.
 */
function assertCanEdit(actor: AuthUser): void {
  if (isPlatformAdmin(actor)) return;
  if (!can(actor, 'course:manage-own')) {
    throw new ForbiddenError(
      'Your instructor access is suspended. You can still browse and learn.',
    );
  }
}
