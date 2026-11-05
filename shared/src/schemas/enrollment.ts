import { z } from 'zod';
import { ENROLLMENT_STATUSES } from '../enums.js';
import { paginationQuerySchema, uuidSchema } from './common.js';
import { courseSummarySchema } from './course.js';

export const enrollmentSchema = z.object({
  id: uuidSchema,
  courseId: uuidSchema,
  userId: uuidSchema,
  status: z.enum(ENROLLMENT_STATUSES),
  enrolledAt: z.string(),
  lastAccessedAt: z.string().nullable(),
  lastLessonId: uuidSchema.nullable(),
  completedAt: z.string().nullable(),
  /** Server-calculated: completed lessons ÷ total lessons. */
  progressPercentage: z.number().int().min(0).max(100),
  completedLessons: z.number().int().min(0),
  totalLessons: z.number().int().min(0),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

/** `GET /enrollments/me` returns the course alongside each enrollment. */
export const enrollmentWithCourseSchema = enrollmentSchema.extend({
  course: courseSummarySchema,
});
export type EnrollmentWithCourse = z.infer<typeof enrollmentWithCourseSchema>;

export const enrollmentQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ENROLLMENT_STATUSES).optional(),
});
export type EnrollmentQuery = z.infer<typeof enrollmentQuerySchema>;
