import { z } from 'zod';
import { LESSON_STATUSES } from '../enums.js';
import { emptyToUndefined, mediaUrlSchema, uuidSchema } from './common.js';

export const moduleInputSchema = z.object({
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(140),
  /** Optional: the server appends to the end when it is absent. */
  order: z.number().int().min(1).optional(),
});
export type ModuleInput = z.infer<typeof moduleInputSchema>;

export const moduleUpdateSchema = moduleInputSchema.partial();
export type ModuleUpdateInput = z.infer<typeof moduleUpdateSchema>;

/**
 * Durations are stored in seconds and must be positive: the completion maths
 * divides by this value.  Enforced in Zod, by a Prisma field and by a DB CHECK
 * constraint added in a raw-SQL migration, so no path can write a zero.
 */
export const durationSecondsSchema = z.coerce
  .number()
  .int('Use whole seconds')
  .min(1, 'Duration must be at least 1 second')
  .max(60 * 60 * 12, 'Duration must be under 12 hours');

export const lessonInputSchema = z.object({
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(140),
  description: z.string().trim().max(2000).default(''),
  videoUrl: mediaUrlSchema,
  captionsUrl: emptyToUndefined(mediaUrlSchema),
  durationSeconds: durationSecondsSchema,
  isPreview: z.boolean().default(false),
  order: z.number().int().min(1).optional(),
});
export type LessonInput = z.infer<typeof lessonInputSchema>;

export const lessonUpdateSchema = lessonInputSchema.partial();
export type LessonUpdateInput = z.infer<typeof lessonUpdateSchema>;

export const reorderLessonsSchema = z.object({
  lessonIds: z.array(uuidSchema).min(1, 'Send at least one lesson id'),
});
export type ReorderLessonsInput = z.infer<typeof reorderLessonsSchema>;

/** Per-lesson progress as the learner's own view of it. */
export const lessonProgressStateSchema = z.object({
  lastPositionSeconds: z.number().int().min(0),
  maxWatchedSeconds: z.number().int().min(0),
  completionPercentage: z.number().int().min(0).max(100),
  isCompleted: z.boolean(),
  completedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type LessonProgressState = z.infer<typeof lessonProgressStateSchema>;

export const lessonSummarySchema = z.object({
  id: uuidSchema,
  moduleId: uuidSchema,
  courseId: uuidSchema,
  title: z.string(),
  description: z.string(),
  durationSeconds: z.number().int(),
  order: z.number().int(),
  isPreview: z.boolean(),
  /** NOT_STARTED | IN_PROGRESS | COMPLETED | LOCKED — decided by the server. */
  status: z.enum(LESSON_STATUSES),
  progress: lessonProgressStateSchema.nullable(),
});
export type LessonSummary = z.infer<typeof lessonSummarySchema>;

/** The player payload: adds the media URLs and sibling navigation. */
export const lessonDetailSchema = lessonSummarySchema.extend({
  videoUrl: z.string(),
  captionsUrl: z.string().nullable(),
  module: z.object({ id: uuidSchema, title: z.string(), order: z.number().int() }),
  course: z.object({ id: uuidSchema, slug: z.string(), title: z.string() }),
  previousLessonId: uuidSchema.nullable(),
  nextLessonId: uuidSchema.nullable(),
  /** True when the caller may record progress (an active enrollment exists). */
  isTracked: z.boolean(),
});
export type LessonDetail = z.infer<typeof lessonDetailSchema>;
