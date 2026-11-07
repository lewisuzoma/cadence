/**
 * Domain enums shared by the client, the server and Prisma.
 *
 * These string unions mirror the Prisma enums exactly.  Prisma generates its
 * own TypeScript enums, but the client must not import from `@prisma/client`,
 * so these are the single source of truth for both sides and are asserted
 * against the Prisma types in the server's unit tests.
 */

/**
 * Roles are additive and ordered: INSTRUCTOR can do everything a LEARNER can,
 * ADMIN everything an INSTRUCTOR can plus the platform-wide work.  The
 * capability that order implies lives in `permissions.ts`; nothing outside
 * that file should compare roles for equality.
 */
export const ROLES = ['LEARNER', 'INSTRUCTOR', 'ADMIN'] as const;
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

// --- instructor feature ----------------------------------------------------

/**
 * Application lifecycle.  `NOT_APPLIED` is deliberately absent: it is the
 * absence of a row, derived by the service, never a stored value.  Storing it
 * would mean two ways to express "has not applied" and a class of bugs where
 * they disagree.
 */
export const INSTRUCTOR_APPLICATION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type InstructorApplicationStatus = (typeof INSTRUCTOR_APPLICATION_STATUSES)[number];

/** What the applicant sees, including the derived "never applied" case. */
export const INSTRUCTOR_APPLICATION_VIEW_STATUSES = [
  'NOT_APPLIED',
  ...INSTRUCTOR_APPLICATION_STATUSES,
  'SUSPENDED',
] as const;
export type InstructorApplicationViewStatus =
  (typeof INSTRUCTOR_APPLICATION_VIEW_STATUSES)[number];

/**
 * Instructor standing.  Separate from `Role` on purpose: suspension removes
 * teaching capability without touching the role, so the user keeps every
 * learner permission and their history stays intact.
 */
export const INSTRUCTOR_PROFILE_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type InstructorProfileStatus = (typeof INSTRUCTOR_PROFILE_STATUSES)[number];

/** Append-only audit actions on an application or an instructor profile. */
export const INSTRUCTOR_APPLICATION_ACTIONS = [
  'SUBMITTED',
  'UPDATED',
  'WITHDRAWN',
  'APPROVED',
  'REJECTED',
  'NOTE_ADDED',
  'SUSPENDED',
  'REINSTATED',
] as const;
export type InstructorApplicationAction = (typeof INSTRUCTOR_APPLICATION_ACTIONS)[number];

/** Course lifecycle events; these feed the activity feed and notifications. */
export const COURSE_EVENT_TYPES = [
  'CREATED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
  'LESSONS_ADDED',
] as const;
export type CourseEventType = (typeof COURSE_EVENT_TYPES)[number];

export const MEDIA_KINDS = ['VIDEO', 'IMAGE'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * An asset is only playable once it is READY: the server has verified the
 * object's real type from its magic bytes and read its duration.
 */
export const MEDIA_STATUSES = ['PENDING', 'READY', 'FAILED'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'APPLICATION_SUBMITTED',
  'APPLICATION_RECEIVED',
  'APPLICATION_APPROVED',
  'APPLICATION_REJECTED',
  'APPLICATION_WITHDRAWN',
  'INSTRUCTOR_SUSPENDED',
  'INSTRUCTOR_REINSTATED',
  'COURSE_PUBLISHED',
  'COURSE_UNPUBLISHED',
  'COURSE_ARCHIVED',
  'COURSE_LESSONS_ADDED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Progress bands used by the analytics distribution chart and the filters. */
export const PROGRESS_BANDS = ['0-25', '25-50', '50-75', '75-99', '100'] as const;
export type ProgressBand = (typeof PROGRESS_BANDS)[number];

export const INSTRUCTOR_COURSE_SORTS = ['newest', 'oldest', 'title', 'learners'] as const;
export type InstructorCourseSort = (typeof INSTRUCTOR_COURSE_SORTS)[number];

export const LEARNER_TABLE_SORTS = [
  'name',
  'enrolled',
  'progress',
  'activity',
] as const;
export type LearnerTableSort = (typeof LEARNER_TABLE_SORTS)[number];
