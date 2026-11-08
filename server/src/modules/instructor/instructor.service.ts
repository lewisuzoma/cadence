import type {
  InstructorActivityItem,
  InstructorActivityQuery,
  InstructorCourseCard,
  InstructorCourseQuery,
  InstructorDashboard,
} from '@cadence/shared';
import type { Prisma } from '@prisma/client';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthUser } from '../../middlewares/types.js';
import { coursesRepository } from '../courses/courses.repository.js';
import { coursesService } from '../courses/courses.service.js';
import { instructorRepository } from './instructor.repository.js';

/**
 * The teaching workspace's read model.
 *
 * Everything is scoped to `actor.id`. An admin reaching these endpoints sees
 * their *own* authored courses, not the platform — the platform view lives
 * under `/admin`, and conflating the two is how an "instructor dashboard"
 * ends up leaking the whole catalogue to whoever happens to be an admin.
 */

/** Seconds in a day, for the activity window. */
const DAY_MS = 24 * 60 * 60 * 1000;

function orderFor(sort: InstructorCourseQuery['sort']): Prisma.CourseOrderByWithRelationInput[] {
  switch (sort) {
    case 'oldest':
      return [{ createdAt: 'asc' }];
    case 'title':
      return [{ title: 'asc' }];
    case 'learners':
      // Learner counts are aggregated separately, so the page is ordered
      // after decoration; this keeps the underlying order deterministic.
      return [{ createdAt: 'desc' }];
    case 'newest':
    default:
      return [{ createdAt: 'desc' }];
  }
}

/** Attaches the teaching statistics to a page of course rows. */
async function decorateCards(
  rows: {
    id: string;
    slug: string;
    title: string;
    shortDescription: string;
    category: string;
    thumbnailUrl: string;
    difficulty: InstructorCourseCard['difficulty'];
    status: InstructorCourseCard['status'];
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
  }[],
  ownerId: string,
): Promise<InstructorCourseCard[]> {
  const ids = rows.map((row) => row.id);
  const [aggregates, rollups, averages, needingVideo, versions] = await Promise.all([
    coursesRepository.aggregateLessons(ids),
    instructorRepository.enrollmentRollup(ids, ownerId),
    instructorRepository.averageProgress(ids, ownerId),
    instructorRepository.lessonsNeedingVideo(ids),
    instructorRepository.liveVersionNumbers(ids),
  ]);

  const aggregateBy = new Map(aggregates.map((row) => [row.courseId, row]));
  const rollupBy = new Map(rollups.map((row) => [row.courseId, row]));
  const averageBy = new Map(averages.map((row) => [row.courseId, row.averageProgress]));
  const videoBy = new Map(needingVideo.map((row) => [row.courseId, row.count]));
  const versionBy = new Map(versions.map((row) => [row.courseId, row]));

  /*
   * "Has unpublished changes" is derived cheaply here rather than by
   * running the full field-by-field diff per card: a course whose draft
   * has been touched since its live version was published is the signal
   * the card needs, and the editor does the precise comparison when the
   * instructor actually opens it.
   */
  return rows.map((row) => {
    const rollup = rollupBy.get(row.id);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      shortDescription: row.shortDescription,
      category: row.category,
      thumbnailUrl: row.thumbnailUrl,
      difficulty: row.difficulty,
      status: row.status,
      lessonCount: aggregateBy.get(row.id)?.lessonCount ?? 0,
      estimatedDuration: aggregateBy.get(row.id)?.totalDuration ?? 0,
      enrolledLearners: rollup?.enrolled ?? 0,
      newEnrollments7d: rollup?.newEnrollments7d ?? 0,
      // `null`, not 0, when nobody is enrolled: the card renders a dash,
      // because "0% average" and "no learners yet" are different facts.
      averageProgress: (rollup?.enrolled ?? 0) === 0 ? null : (averageBy.get(row.id) ?? 0),
      lessonsNeedingVideo: videoBy.get(row.id) ?? 0,
      hasUnpublishedChanges: versionBy.get(row.id)?.stale ?? false,
      liveVersion: versionBy.get(row.id)?.version ?? null,
      createdAt: row.createdAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
    };
  });
}

export const instructorService = {
  /** The workspace overview: six stat cards, the course rail, a draft nudge. */
  async dashboard(actor: AuthUser): Promise<InstructorDashboard> {
    const courseIds = await instructorRepository.ownedCourseIds(actor.id);

    const [counts, learners, newEnrollments, lessonsCompleted, rollups, rows] =
      await Promise.all([
        instructorRepository.statusCounts(actor.id),
        instructorRepository.distinctLearners(courseIds, actor.id),
        instructorRepository.newEnrollments(courseIds, actor.id, 7),
        instructorRepository.lessonsCompleted(courseIds, actor.id),
        instructorRepository.enrollmentRollup(courseIds, actor.id),
        prisma.course.findMany({
          where: { createdById: actor.id },
          orderBy: [{ createdAt: 'desc' }],
          take: 6,
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
      ]);

    const totalEnrolled = rollups.reduce((sum, row) => sum + row.enrolled, 0);
    const totalCompleted = rollups.reduce((sum, row) => sum + row.completed, 0);

    const courses = await decorateCards(rows, actor.id);

    return {
      stats: {
        totalCourses: counts.DRAFT + counts.PUBLISHED + counts.ARCHIVED,
        publishedCourses: counts.PUBLISHED,
        draftCourses: counts.DRAFT,
        archivedCourses: counts.ARCHIVED,
        enrolledLearners: learners,
        newEnrollments7d: newEnrollments,
        lessonsCompleted,
        // Completed ÷ enrolled across every course, as the artifact's
        // "Avg completion rate" card defines it. Zero enrollments is 0%,
        // not a division by zero.
        averageCompletionRate:
          totalEnrolled === 0 ? 0 : Math.round((totalCompleted / totalEnrolled) * 100),
      },
      courses,
      draftNudge: await this.draftNudge(actor),
    };
  },

  /**
   * The draft closest to publishable, for the "Finish your draft" card.
   *
   * Picks the draft with the fewest outstanding checks, because that is the
   * one the instructor is most likely to finish in one sitting. Returns
   * `null` when there are no drafts, and the card is simply not rendered.
   */
  async draftNudge(actor: AuthUser): Promise<InstructorDashboard['draftNudge']> {
    const drafts = await prisma.course.findMany({
      where: { createdById: actor.id, status: 'DRAFT' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true },
    });
    if (drafts.length === 0) return null;

    const checklists = await Promise.all(
      drafts.map(async (draft) => ({
        draft,
        checklist: await coursesService.publishChecklist(draft.id, actor),
      })),
    );

    const best = checklists
      .filter((entry) => !entry.checklist.canPublish)
      .sort(
        (a, b) =>
          b.checklist.passing / b.checklist.total - a.checklist.passing / a.checklist.total,
      )[0];
    if (!best) return null;

    const failing = best.checklist.checks.filter((check) => !check.passed);
    return {
      courseId: best.draft.id,
      title: best.draft.title,
      passing: best.checklist.passing,
      total: best.checklist.total,
      summary:
        failing.length === 1
          ? (failing[0]!.detail ?? failing[0]!.label)
          : `${failing.length} checks still to pass.`,
    };
  },

  /** "My courses", with the tab counts the artifact shows beside each filter. */
  async listCourses(query: InstructorCourseQuery, actor: AuthUser) {
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const where: Prisma.CourseWhereInput = {
      // The scope, applied in SQL. Not a filter over a wider result set.
      createdById: actor.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { shortDescription: { contains: query.search, mode: 'insensitive' } },
              { category: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [[rows, total], counts] = await Promise.all([
      instructorRepository.listOwnedCourses({
        where,
        orderBy: orderFor(query.sort),
        skip,
        take,
      }),
      instructorRepository.statusCounts(actor.id),
    ]);

    const items = await decorateCards(rows, actor.id);
    if (query.sort === 'learners') {
      items.sort((a, b) => b.enrolledLearners - a.enrolledLearners);
    }

    return {
      items,
      meta: buildMeta(query.page, query.pageSize, total),
      counts: {
        ...counts,
        ALL: counts.DRAFT + counts.PUBLISHED + counts.ARCHIVED,
      },
    };
  },

  /**
   * The activity feed.
   *
   * Four real sources — enrollments, lesson completions, progress milestones
   * and course events — merged and sorted by time. Nothing here is invented
   * or interpolated; an empty feed means nothing happened.
   */
  async activity(query: InstructorActivityQuery, actor: AuthUser) {
    const courseIds = await instructorRepository.ownedCourseIds(actor.id);
    const scoped = query.courseId
      ? courseIds.filter((id) => id === query.courseId)
      : courseIds;

    // A courseId the actor does not own narrows the scope to nothing rather
    // than widening it — the feed stays empty instead of leaking.
    if (scoped.length === 0) {
      return { items: [], meta: buildMeta(query.page, query.pageSize, 0) };
    }

    const since = new Date(Date.now() - query.days * DAY_MS);
    // Over-fetch each source, merge, then page: the merge order is by time
    // across sources, which no single query can produce.
    const fetchLimit = Math.min(200, query.page * query.pageSize + query.pageSize);

    const wants = (kind: InstructorActivityItem['kind']) => !query.kind || query.kind === kind;

    const [enrollments, completions, milestones, events] = await Promise.all([
      wants('ENROLLMENT')
        ? instructorRepository.recentEnrollments(scoped, actor.id, since, fetchLimit)
        : Promise.resolve([]),
      wants('LESSON_COMPLETED')
        ? instructorRepository.recentCompletions(scoped, actor.id, since, fetchLimit)
        : Promise.resolve([]),
      wants('MILESTONE')
        ? instructorRepository.recentMilestones(scoped, actor.id, since, fetchLimit)
        : Promise.resolve([]),
      wants('COURSE_EVENT')
        ? instructorRepository.recentCourseEvents(scoped, since, fetchLimit)
        : Promise.resolve([]),
    ]);

    const items: InstructorActivityItem[] = [
      ...enrollments.map((row) => ({
        id: `enrollment:${row.id}`,
        kind: 'ENROLLMENT' as const,
        learner: {
          id: row.user.id,
          name: `${row.user.firstName} ${row.user.lastName}`,
        },
        courseId: row.course.id,
        courseTitle: row.course.title,
        lessonTitle: null,
        milestone: null,
        courseEventType: null,
        occurredAt: row.enrolledAt.toISOString(),
      })),
      ...completions.map((row) => ({
        id: `completion:${row.id}`,
        kind: 'LESSON_COMPLETED' as const,
        learner: {
          id: row.user.id,
          name: `${row.user.firstName} ${row.user.lastName}`,
        },
        courseId: row.lesson.course.id,
        courseTitle: row.lesson.course.title,
        lessonTitle: row.lesson.title,
        milestone: null,
        courseEventType: null,
        occurredAt: (row.completedAt ?? new Date()).toISOString(),
      })),
      ...milestones.map((row) => ({
        id: `milestone:${row.courseId}:${row.userId}:${row.milestone}`,
        kind: 'MILESTONE' as const,
        learner: { id: row.userId, name: `${row.firstName} ${row.lastName}` },
        courseId: row.courseId,
        courseTitle: row.courseTitle,
        lessonTitle: null,
        milestone: row.milestone,
        courseEventType: null,
        occurredAt: new Date(row.at).toISOString(),
      })),
      ...events.map((row) => ({
        id: `course-event:${row.id}`,
        kind: 'COURSE_EVENT' as const,
        learner: null,
        courseId: row.course.id,
        courseTitle: row.course.title,
        lessonTitle: null,
        milestone: null,
        courseEventType: row.type,
        occurredAt: row.createdAt.toISOString(),
      })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    const { skip, take } = toSkipTake(query.page, query.pageSize);
    return {
      items: items.slice(skip, skip + take),
      meta: buildMeta(query.page, query.pageSize, items.length),
    };
  },
};
