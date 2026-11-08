import type { Prisma } from '@prisma/client';
import type { CourseVersionSummary, PendingChange } from '@cadence/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * Course content versioning.
 *
 * The model in one sentence: **the Course row is the instructor's draft,
 * and a CourseVersion is what learners see.**
 *
 * Before this existed, correcting a typo and restructuring a curriculum
 * were the same operation and both landed on learners mid-lesson. Now an
 * instructor can work on the next revision of a live course and decide
 * when it goes out.
 *
 * The snapshot references lessons by their stable id rather than copying
 * them, because `LessonProgress` is keyed by `lessonId`: duplicating
 * lesson rows per version would orphan every learner's history on each
 * publish. So a version records *how a lesson was presented* — its
 * title, description, duration, order and module — while the lesson
 * itself stays one row with one identity.
 */

/** The live course as a learner sees it: version metadata + its lessons. */
export type LiveCourseContent = {
  versionId: string;
  version: number;
  publishedAt: Date;
  title: string;
  shortDescription: string;
  description: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  thumbnailUrl: string;
  learningObjectives: string[];
  prerequisites: string[];
  targetAudience: string;
  lessons: {
    lessonId: string;
    moduleTitle: string;
    moduleOrder: number;
    title: string;
    description: string;
    durationSeconds: number;
    order: number;
    isPreview: boolean;
  }[];
};

const versionWithLessons = {
  include: { lessons: { orderBy: [{ moduleOrder: 'asc' }, { order: 'asc' }] } },
} satisfies Prisma.CourseVersionDefaultArgs;

type VersionRow = Prisma.CourseVersionGetPayload<typeof versionWithLessons>;

function toLiveContent(row: VersionRow): LiveCourseContent {
  return {
    versionId: row.id,
    version: row.version,
    publishedAt: row.publishedAt,
    title: row.title,
    shortDescription: row.shortDescription,
    description: row.description,
    category: row.category,
    difficulty: row.difficulty,
    thumbnailUrl: row.thumbnailUrl,
    learningObjectives: row.learningObjectives,
    prerequisites: row.prerequisites,
    targetAudience: row.targetAudience,
    lessons: row.lessons.map((lesson) => ({
      lessonId: lesson.lessonId,
      moduleTitle: lesson.moduleTitle,
      moduleOrder: lesson.moduleOrder,
      title: lesson.title,
      description: lesson.description,
      durationSeconds: lesson.durationSeconds,
      order: lesson.order,
      isPreview: lesson.isPreview,
    })),
  };
}

export const courseVersions = {
  /** The version learners currently see, or `null` if never published. */
  async live(courseId: string): Promise<LiveCourseContent | null> {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { liveVersionId: true },
    });
    if (!course?.liveVersionId) return null;

    const row = await prisma.courseVersion.findUnique({
      where: { id: course.liveVersionId },
      ...versionWithLessons,
    });
    return row ? toLiveContent(row) : null;
  },

  /** Live content for several courses at once, for the catalog listing. */
  async liveForCourses(courseIds: string[]): Promise<Map<string, LiveCourseContent>> {
    if (courseIds.length === 0) return new Map();

    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds }, liveVersionId: { not: null } },
      select: { id: true, liveVersionId: true },
    });

    const versionIds = courses
      .map((course) => course.liveVersionId)
      .filter((id): id is string => id !== null);
    if (versionIds.length === 0) return new Map();

    const rows = await prisma.courseVersion.findMany({
      where: { id: { in: versionIds } },
      ...versionWithLessons,
    });
    const byVersionId = new Map(rows.map((row) => [row.id, toLiveContent(row)]));

    const result = new Map<string, LiveCourseContent>();
    for (const course of courses) {
      const content = course.liveVersionId
        ? byVersionId.get(course.liveVersionId)
        : undefined;
      if (content) result.set(course.id, content);
    }
    return result;
  },

  /**
   * Freezes the current draft as a new version and points the course at
   * it.
   *
   * Runs inside the caller's transaction, because publishing is one
   * decision: the status change, the snapshot and the course event all
   * land together or not at all.
   */
  async publish(
    tx: Prisma.TransactionClient,
    params: { courseId: string; actorId: string; changeSummary?: string | undefined },
  ): Promise<{ versionId: string; version: number }> {
    const course = await tx.course.findUniqueOrThrow({
      where: { id: params.courseId },
      select: {
        title: true,
        shortDescription: true,
        description: true,
        category: true,
        difficulty: true,
        thumbnailUrl: true,
        learningObjectives: true,
        prerequisites: true,
        targetAudience: true,
      },
    });

    const previous = await tx.courseVersion.findFirst({
      where: { courseId: params.courseId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (previous?.version ?? 0) + 1;

    const created = await tx.courseVersion.create({
      data: {
        courseId: params.courseId,
        version,
        title: course.title,
        shortDescription: course.shortDescription,
        description: course.description,
        category: course.category,
        difficulty: course.difficulty,
        thumbnailUrl: course.thumbnailUrl,
        learningObjectives: course.learningObjectives,
        prerequisites: course.prerequisites,
        targetAudience: course.targetAudience,
        publishedById: params.actorId,
        ...(params.changeSummary ? { changeSummary: params.changeSummary } : {}),
      },
    });

    const lessons = await tx.lesson.findMany({
      where: { courseId: params.courseId },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
      select: {
        id: true,
        title: true,
        description: true,
        durationSeconds: true,
        order: true,
        isPreview: true,
        module: { select: { title: true, order: true } },
      },
    });

    if (lessons.length > 0) {
      await tx.courseVersionLesson.createMany({
        data: lessons.map((lesson) => ({
          versionId: created.id,
          lessonId: lesson.id,
          moduleTitle: lesson.module.title,
          moduleOrder: lesson.module.order,
          title: lesson.title,
          description: lesson.description,
          durationSeconds: lesson.durationSeconds,
          order: lesson.order,
          isPreview: lesson.isPreview,
        })),
      });
    }

    await tx.course.update({
      where: { id: params.courseId },
      data: { liveVersionId: created.id },
    });

    return { versionId: created.id, version };
  },

  /**
   * What differs between the draft and what learners can see.
   *
   * Returned as a list of human-readable changes rather than a boolean,
   * because the instructor's question is never "is something different?"
   * but "what will my learners notice if I publish?".
   */
  async pendingChanges(courseId: string): Promise<PendingChange[]> {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        liveVersionId: true,
        title: true,
        shortDescription: true,
        description: true,
        category: true,
        difficulty: true,
        thumbnailUrl: true,
        learningObjectives: true,
        prerequisites: true,
        targetAudience: true,
      },
    });
    // Never published: everything is pending, but there is nothing to
    // compare against, so the publish button speaks for itself.
    if (!course?.liveVersionId) return [];

    const live = await prisma.courseVersion.findUnique({
      where: { id: course.liveVersionId },
      ...versionWithLessons,
    });
    if (!live) return [];

    const changes: PendingChange[] = [];

    const fields: { key: string; label: string; draft: unknown; published: unknown }[] = [
      { key: 'title', label: 'Title', draft: course.title, published: live.title },
      {
        key: 'shortDescription',
        label: 'Short description',
        draft: course.shortDescription,
        published: live.shortDescription,
      },
      {
        key: 'description',
        label: 'Full description',
        draft: course.description,
        published: live.description,
      },
      { key: 'category', label: 'Category', draft: course.category, published: live.category },
      {
        key: 'difficulty',
        label: 'Difficulty',
        draft: course.difficulty,
        published: live.difficulty,
      },
      {
        key: 'thumbnailUrl',
        label: 'Thumbnail',
        draft: course.thumbnailUrl,
        published: live.thumbnailUrl,
      },
      {
        key: 'learningObjectives',
        label: 'Learning objectives',
        draft: course.learningObjectives.join('\u0000'),
        published: live.learningObjectives.join('\u0000'),
      },
      {
        key: 'prerequisites',
        label: 'Prerequisites',
        draft: course.prerequisites.join('\u0000'),
        published: live.prerequisites.join('\u0000'),
      },
      {
        key: 'targetAudience',
        label: 'Target audience',
        draft: course.targetAudience,
        published: live.targetAudience,
      },
    ];

    for (const field of fields) {
      if (field.draft !== field.published) {
        changes.push({ kind: 'COURSE_FIELD', field: field.key, label: field.label });
      }
    }

    // --- the curriculum ---------------------------------------------------
    const draftLessons = await prisma.lesson.findMany({
      where: { courseId },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
      select: {
        id: true,
        title: true,
        description: true,
        durationSeconds: true,
        order: true,
        isPreview: true,
        module: { select: { title: true, order: true } },
      },
    });

    const publishedById = new Map(live.lessons.map((lesson) => [lesson.lessonId, lesson]));
    const draftById = new Map(draftLessons.map((lesson) => [lesson.id, lesson]));

    for (const lesson of draftLessons) {
      const was = publishedById.get(lesson.id);
      if (!was) {
        changes.push({
          kind: 'LESSON_ADDED',
          field: lesson.id,
          label: `New lesson: ${lesson.title}`,
        });
        continue;
      }

      const edited =
        was.title !== lesson.title ||
        was.description !== lesson.description ||
        was.durationSeconds !== lesson.durationSeconds ||
        was.isPreview !== lesson.isPreview ||
        was.moduleTitle !== lesson.module.title;
      if (edited) {
        changes.push({
          kind: 'LESSON_EDITED',
          field: lesson.id,
          label: `Edited: ${lesson.title}`,
        });
      }
    }

    /*
     * Removals.
     *
     * Normally empty, and deliberately so: deleting a lesson cascades to
     * its snapshot rows, so a deletion reaches learners at once rather
     * than waiting for a publish. That is not an oversight — deleting a
     * lesson also deletes every learner's progress on it, and there is
     * no honest way to defer that half-way. The published curriculum
     * getting shorter is better than it listing a lesson nobody can
     * play.
     *
     * The check stays because it is the correct answer if a snapshot
     * ever outlives its lesson, and it costs one pass over a short list.
     */
    for (const lesson of live.lessons) {
      if (!draftById.has(lesson.lessonId)) {
        changes.push({
          kind: 'LESSON_REMOVED',
          field: lesson.lessonId,
          label: `Removed: ${lesson.title}`,
        });
      }
    }

    // Reordering is reported once rather than per lesson: an instructor
    // who moves one lesson up has "changed the order", not changed five.
    const draftOrder = draftLessons
      .filter((lesson) => publishedById.has(lesson.id))
      .map((lesson) => lesson.id)
      .join(',');
    const publishedOrder = live.lessons
      .filter((lesson) => draftById.has(lesson.lessonId))
      .map((lesson) => lesson.lessonId)
      .join(',');
    if (draftOrder !== publishedOrder) {
      changes.push({
        kind: 'LESSONS_REORDERED',
        field: 'order',
        label: 'Lesson order changed',
      });
    }

    return changes;
  },

  /** The published history, newest first. */
  async history(courseId: string): Promise<CourseVersionSummary[]> {
    const rows = await prisma.courseVersion.findMany({
      where: { courseId },
      orderBy: { version: 'desc' },
      include: {
        publishedBy: { select: { firstName: true, lastName: true } },
        _count: { select: { lessons: true } },
      },
    });

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { liveVersionId: true },
    });

    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      publishedAt: row.publishedAt.toISOString(),
      publishedBy: `${row.publishedBy.firstName} ${row.publishedBy.lastName}`,
      changeSummary: row.changeSummary,
      lessonCount: row._count.lessons,
      isLive: row.id === course?.liveVersionId,
    }));
  },
};
