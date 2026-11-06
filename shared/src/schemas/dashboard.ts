import { z } from 'zod';
import { ACTIVITY_TYPES } from '../enums.js';
import { paginationQuerySchema, uuidSchema } from './common.js';
import { courseSummarySchema } from './course.js';
import { enrollmentWithCourseSchema } from './enrollment.js';

export const activityItemSchema = z.object({
  id: z.string(),
  type: z.enum(ACTIVITY_TYPES),
  occurredAt: z.string(),
  courseId: uuidSchema,
  courseTitle: z.string(),
  courseSlug: z.string(),
  lessonId: uuidSchema.nullable(),
  lessonTitle: z.string().nullable(),
  /** Only present on the admin feed, which spans every learner. */
  user: z
    .object({ id: uuidSchema, firstName: z.string(), lastName: z.string(), email: z.string() })
    .nullable(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;

/** The "Continue learning" card: where the learner left off. */
export const continueLearningSchema = z.object({
  courseId: uuidSchema,
  courseSlug: z.string(),
  courseTitle: z.string(),
  thumbnailUrl: z.string(),
  lessonId: uuidSchema,
  lessonTitle: z.string(),
  moduleTitle: z.string(),
  lastPositionSeconds: z.number().int().min(0),
  durationSeconds: z.number().int(),
  courseProgressPercentage: z.number().int().min(0).max(100),
});
export type ContinueLearning = z.infer<typeof continueLearningSchema>;

export const learnerDashboardSchema = z.object({
  stats: z.object({
    enrolledCourses: z.number().int().min(0),
    inProgressCourses: z.number().int().min(0),
    completedCourses: z.number().int().min(0),
    completedLessons: z.number().int().min(0),
    totalLessons: z.number().int().min(0),
    /** Completed lessons ÷ lessons across every enrolled course. */
    overallProgressPercentage: z.number().int().min(0).max(100),
    watchedSeconds: z.number().int().min(0),
    /** Consecutive days with activity, derived from lesson_progress. */
    streakDays: z.number().int().min(0),
    /** Lessons finished in the last seven days. */
    lessonsThisWeek: z.number().int().min(0),
  }),
  continueLearning: continueLearningSchema.nullable(),
  courses: z.array(enrollmentWithCourseSchema),
  recentActivity: z.array(activityItemSchema),
});
export type LearnerDashboard = z.infer<typeof learnerDashboardSchema>;

export const adminCourseStatSchema = z.object({
  courseId: uuidSchema,
  title: z.string(),
  enrollments: z.number().int().min(0),
  completions: z.number().int().min(0),
  completionRate: z.number().int().min(0).max(100),
});
export type AdminCourseStat = z.infer<typeof adminCourseStatSchema>;

export const adminDashboardSchema = z.object({
  stats: z.object({
    learners: z.number().int().min(0),
    activeLearners: z.number().int().min(0),
    courses: z.number().int().min(0),
    publishedCourses: z.number().int().min(0),
    draftCourses: z.number().int().min(0),
    archivedCourses: z.number().int().min(0),
    lessons: z.number().int().min(0),
    enrollments: z.number().int().min(0),
    completedLessons: z.number().int().min(0),
    completedCourses: z.number().int().min(0),
  }),
  coursePerformance: z.array(adminCourseStatSchema),
  recentActivity: z.array(activityItemSchema),
  recentCourses: z.array(courseSummarySchema),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;

export const activityQuerySchema = paginationQuerySchema;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
