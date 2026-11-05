import type {
  ActivityItem,
  ActivityQuery,
  AdminDashboard,
  ContinueLearning,
  LearnerDashboard,
} from '@cadence/shared';
import { buildMeta, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { buildCourseSummary, indexBy } from '../courses/courses.projection.js';
import { coursesRepository } from '../courses/courses.repository.js';
import { enrollmentService } from '../enrollment/enrollment.service.js';
import { courseProgressPercentage } from '../progress/progress.calculator.js';
import { dashboardRepository, type ActivityRow } from './dashboard.repository.js';

function toActivityItem(row: ActivityRow, includeUser: boolean): ActivityItem {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    courseSlug: row.courseSlug,
    lessonId: row.lessonId,
    lessonTitle: row.lessonTitle,
    user: includeUser
      ? {
          id: row.userId,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
        }
      : null,
  };
}

export const dashboardService = {
  async learner(userId: string): Promise<LearnerDashboard> {
    const [stats, continueRow, enrollments, activity] = await Promise.all([
      dashboardRepository.learnerStats(userId),
      dashboardRepository.continueLearning(userId),
      enrollmentService.listMine(userId, { page: 1, pageSize: 12 }),
      dashboardRepository.queryActivity({ userId, limit: 8, offset: 0 }),
    ]);

    const continueLearning: ContinueLearning | null = continueRow
      ? {
          courseId: continueRow.lesson.course.id,
          courseSlug: continueRow.lesson.course.slug,
          courseTitle: continueRow.lesson.course.title,
          thumbnailUrl: continueRow.lesson.course.thumbnailUrl,
          lessonId: continueRow.lesson.id,
          lessonTitle: continueRow.lesson.title,
          moduleTitle: continueRow.lesson.module.title,
          lastPositionSeconds: continueRow.progress?.lastPositionSeconds ?? 0,
          durationSeconds: continueRow.lesson.durationSeconds,
          courseProgressPercentage: courseProgressPercentage(
            continueRow.completedLessons,
            continueRow.totalLessons,
          ),
        }
      : null;

    return {
      stats: {
        enrolledCourses: stats.activeCourses + stats.completedCourses,
        inProgressCourses: stats.activeCourses,
        completedCourses: stats.completedCourses,
        completedLessons: stats.completedLessons,
        totalLessons: stats.totalLessons,
        overallProgressPercentage: courseProgressPercentage(
          stats.completedLessons,
          stats.totalLessons,
        ),
        watchedSeconds: stats.watchedSeconds,
      },
      continueLearning,
      courses: enrollments.items,
      recentActivity: activity.map((row) => toActivityItem(row, false)),
    };
  },

  async admin(): Promise<AdminDashboard> {
    const [stats, performance, activity, recent] = await Promise.all([
      dashboardRepository.adminStats(),
      dashboardRepository.coursePerformance(),
      dashboardRepository.queryActivity({ limit: 10, offset: 0 }),
      prisma.course.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          category: true,
          thumbnailUrl: true,
          difficulty: true,
          status: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
        },
      }),
    ]);

    const aggregates = await coursesRepository.aggregateLessons(recent.map((row) => row.id));
    const byCourse = indexBy(aggregates, (row) => row.courseId);

    return {
      stats,
      coursePerformance: performance,
      recentActivity: activity.map((row) => toActivityItem(row, true)),
      recentCourses: recent.map((course) =>
        buildCourseSummary({
          course,
          lessonCount: byCourse.get(course.id)?.lessonCount ?? 0,
          totalDuration: byCourse.get(course.id)?.totalDuration ?? 0,
        }),
      ),
    };
  },

  /** The paginated feed: admin-wide, or scoped to one learner. */
  async activity(query: ActivityQuery, userId?: string) {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const [rows, total] = await Promise.all([
      dashboardRepository.queryActivity({ userId, limit: take, offset: skip }),
      dashboardRepository.countActivity(userId),
    ]);
    return {
      items: rows.map((row) => toActivityItem(row, !userId)),
      meta: buildMeta(query.page, query.pageSize, total),
    };
  },
};
