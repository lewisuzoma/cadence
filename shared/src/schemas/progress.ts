import { z } from 'zod';
import { PROGRESS_EVENTS } from '../enums.js';
import { paginationQuerySchema, uuidSchema } from './common.js';
import { lessonProgressStateSchema } from './lesson.js';

/**
 * A progress save.  The client sends where the playhead is and why it is
 * reporting; the server clamps the value and decides what it means.  The
 * client never sends percentages or completion flags.
 */
export const saveProgressSchema = z.object({
  positionSeconds: z.coerce.number().min(0).max(60 * 60 * 12),
  event: z.enum(PROGRESS_EVENTS).default('heartbeat'),
});
export type SaveProgressInput = z.infer<typeof saveProgressSchema>;

export const completeLessonSchema = z.object({
  positionSeconds: z.coerce.number().min(0).max(60 * 60 * 12),
});
export type CompleteLessonInput = z.infer<typeof completeLessonSchema>;

/** What a progress write returns: the lesson's state plus the course roll-up. */
export const progressResultSchema = z.object({
  lessonId: uuidSchema,
  courseId: uuidSchema,
  progress: lessonProgressStateSchema,
  course: z.object({
    progressPercentage: z.number().int().min(0).max(100),
    completedLessons: z.number().int().min(0),
    totalLessons: z.number().int().min(0),
    isCompleted: z.boolean(),
  }),
});
export type ProgressResult = z.infer<typeof progressResultSchema>;

export const progressQuerySchema = paginationQuerySchema.extend({
  courseId: uuidSchema.optional(),
});
export type ProgressQuery = z.infer<typeof progressQuerySchema>;

export const lessonProgressRowSchema = lessonProgressStateSchema.extend({
  lessonId: uuidSchema,
  lessonTitle: z.string(),
  durationSeconds: z.number().int(),
  courseId: uuidSchema,
  courseTitle: z.string(),
  courseSlug: z.string(),
});
export type LessonProgressRow = z.infer<typeof lessonProgressRowSchema>;
