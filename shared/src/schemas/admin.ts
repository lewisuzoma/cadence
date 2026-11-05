import { z } from 'zod';
import { ENROLLMENT_STATUSES, ROLES } from '../enums.js';
import { emptyToUndefined, paginationQuerySchema, uuidSchema } from './common.js';

export const adminUserQuerySchema = paginationQuerySchema.extend({
  search: emptyToUndefined(z.string().trim().max(120)),
  role: emptyToUndefined(z.enum(ROLES)),
  /** `true` / `false` arrive as strings on the query string. */
  isActive: emptyToUndefined(z.enum(['true', 'false'])),
});
export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;

/** The only user field an admin may change: deactivation. */
export const adminUserUpdateSchema = z.object({
  isActive: z.boolean(),
});
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;

export const adminUserRowSchema = z.object({
  id: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  createdAt: z.string(),
  enrolledCourses: z.number().int().min(0),
  completedCourses: z.number().int().min(0),
  completedLessons: z.number().int().min(0),
  /** Completed lessons over lessons in enrolled courses, server-calculated. */
  overallProgressPercentage: z.number().int().min(0).max(100),
  lastActiveAt: z.string().nullable(),
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

export const adminLearnerCourseSchema = z.object({
  courseId: uuidSchema,
  courseTitle: z.string(),
  courseSlug: z.string(),
  status: z.enum(ENROLLMENT_STATUSES),
  enrolledAt: z.string(),
  lastAccessedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedLessons: z.number().int().min(0),
  totalLessons: z.number().int().min(0),
  progressPercentage: z.number().int().min(0).max(100),
});
export type AdminLearnerCourse = z.infer<typeof adminLearnerCourseSchema>;

export const adminLearnerLessonSchema = z.object({
  lessonId: uuidSchema,
  lessonTitle: z.string(),
  courseTitle: z.string(),
  durationSeconds: z.number().int(),
  lastPositionSeconds: z.number().int(),
  completionPercentage: z.number().int().min(0).max(100),
  isCompleted: z.boolean(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type AdminLearnerLesson = z.infer<typeof adminLearnerLessonSchema>;

export const adminLearnerDetailSchema = adminUserRowSchema.extend({
  courses: z.array(adminLearnerCourseSchema),
  lessons: z.array(adminLearnerLessonSchema),
});
export type AdminLearnerDetail = z.infer<typeof adminLearnerDetailSchema>;

export const adminCourseLearnerSchema = z.object({
  userId: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  status: z.enum(ENROLLMENT_STATUSES),
  enrolledAt: z.string(),
  lastAccessedAt: z.string().nullable(),
  completedLessons: z.number().int().min(0),
  totalLessons: z.number().int().min(0),
  progressPercentage: z.number().int().min(0).max(100),
});
export type AdminCourseLearner = z.infer<typeof adminCourseLearnerSchema>;
