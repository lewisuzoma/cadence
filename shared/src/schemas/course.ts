import { z } from 'zod';
import { COURSE_SORTS, COURSE_STATUSES, DIFFICULTIES, ENROLLMENT_STATUSES } from '../enums.js';
import {
  emptyToUndefined,
  mediaUrlSchema,
  paginationQuerySchema,
  slugSchema,
  uuidSchema,
} from './common.js';
import { lessonSummarySchema } from './lesson.js';

export const courseCategorySchema = z
  .string()
  .trim()
  .min(2, 'Category is required')
  .max(60, 'Category must be 60 characters or fewer');

export const courseInputSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(140),
  description: z
    .string()
    .trim()
    .min(20, 'Write at least 20 characters so learners know what they get')
    .max(5000),
  category: courseCategorySchema,
  thumbnailUrl: mediaUrlSchema,
  difficulty: z.enum(DIFFICULTIES),
  /** Optional on create: the server slugifies the title when it is absent. */
  slug: slugSchema.optional(),
});
export type CourseInput = z.infer<typeof courseInputSchema>;

export const courseUpdateSchema = courseInputSchema.partial();
export type CourseUpdateInput = z.infer<typeof courseUpdateSchema>;

export const courseStatusUpdateSchema = z.object({
  status: z.enum(COURSE_STATUSES),
});
export type CourseStatusUpdateInput = z.infer<typeof courseStatusUpdateSchema>;

/** Catalog filters.  All of them live in the URL so views are shareable. */
export const courseQuerySchema = paginationQuerySchema.extend({
  search: emptyToUndefined(z.string().trim().max(120)),
  category: emptyToUndefined(courseCategorySchema),
  difficulty: emptyToUndefined(z.enum(DIFFICULTIES)),
  sort: z.enum(COURSE_SORTS).default('newest'),
});
export type CourseQuery = z.infer<typeof courseQuerySchema>;

/** The admin catalog can additionally filter by status. */
export const adminCourseQuerySchema = courseQuerySchema.extend({
  status: emptyToUndefined(z.enum(COURSE_STATUSES)),
});
export type AdminCourseQuery = z.infer<typeof adminCourseQuerySchema>;

/** The caller's relationship to a course, computed server-side. */
export const courseEnrollmentStateSchema = z.object({
  isEnrolled: z.boolean(),
  status: z.enum(ENROLLMENT_STATUSES).nullable(),
  progressPercentage: z.number().int().min(0).max(100),
  completedLessons: z.number().int().min(0),
  lastLessonId: uuidSchema.nullable(),
  enrolledAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type CourseEnrollmentState = z.infer<typeof courseEnrollmentStateSchema>;

export const courseSummarySchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  thumbnailUrl: z.string(),
  difficulty: z.enum(DIFFICULTIES),
  status: z.enum(COURSE_STATUSES),
  lessonCount: z.number().int().min(0),
  /** Sum of the lessons' durations, in seconds.  Derived, never stored. */
  estimatedDuration: z.number().int().min(0),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Present only when the request is authenticated. */
  enrollment: courseEnrollmentStateSchema.nullable(),
});
export type CourseSummary = z.infer<typeof courseSummarySchema>;

export const moduleWithLessonsSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  order: z.number().int(),
  lessons: z.array(lessonSummarySchema),
});
export type ModuleWithLessons = z.infer<typeof moduleWithLessonsSchema>;

export const courseDetailSchema = courseSummarySchema.extend({
  modules: z.array(moduleWithLessonsSchema),
  createdBy: z.object({ id: uuidSchema, firstName: z.string(), lastName: z.string() }).nullable(),
});
export type CourseDetail = z.infer<typeof courseDetailSchema>;
