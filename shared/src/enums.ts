/**
 * Domain enums shared by the client, the server and Prisma.
 *
 * These string unions mirror the Prisma enums exactly.  Prisma generates its
 * own TypeScript enums, but the client must not import from `@prisma/client`,
 * so these are the single source of truth for both sides and are asserted
 * against the Prisma types in the server's unit tests.
 */

export const ROLES = ['LEARNER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const COURSE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ENROLLMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** Why the client is flushing a progress update. */
export const PROGRESS_EVENTS = ['heartbeat', 'pause', 'seeked', 'hidden'] as const;
export type ProgressEvent = (typeof PROGRESS_EVENTS)[number];

/** Per-lesson display status, derived by the server. */
export const LESSON_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'LOCKED'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const ACTIVITY_TYPES = [
  'ENROLLED',
  'LESSON_STARTED',
  'LESSON_COMPLETED',
  'COURSE_COMPLETED',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const COURSE_SORTS = ['newest', 'oldest', 'title', 'duration'] as const;
export type CourseSort = (typeof COURSE_SORTS)[number];
