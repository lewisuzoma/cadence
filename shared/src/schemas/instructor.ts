import { z } from 'zod';
import {
  COURSE_EVENT_TYPES,
  DIFFICULTIES,
  ENROLLMENT_STATUSES,
  INSTRUCTOR_APPLICATION_ACTIONS,
  INSTRUCTOR_APPLICATION_STATUSES,
  INSTRUCTOR_APPLICATION_VIEW_STATUSES,
  INSTRUCTOR_COURSE_SORTS,
  INSTRUCTOR_PROFILE_STATUSES,
  LEARNER_TABLE_SORTS,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  PROGRESS_BANDS,
} from '../enums.js';
import { emptyToUndefined, paginationQuerySchema, uuidSchema } from './common.js';

/**
 * Instructor-feature contracts.
 *
 * As everywhere else in the app these schemas are the single source of truth:
 * React Hook Form validates against them in the browser, the `validate`
 * middleware validates against them on the server, and the OpenAPI document
 * is generated from them. A field cannot drift between the three.
 */

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export const EXPERTISE_MIN = 1;
export const EXPERTISE_MAX = 10;
export const BIOGRAPHY_MIN = 80;
export const BIOGRAPHY_MAX = 600;
export const MOTIVATION_MIN = 50;
export const MOTIVATION_MAX = 800;
export const EXPERIENCE_MIN = 40;
export const EXPERIENCE_MAX = 1000;

const expertiseTagSchema = z
  .string()
  .trim()
  .min(2, 'Each topic needs at least 2 characters')
  .max(40, 'Keep each topic under 40 characters');

/**
 * Only `https://`.
 *
 * A portfolio link is rendered as an anchor on an admin's screen, so `http://`
 * (downgrade) and anything exotic like `javascript:` are refused outright
 * rather than sanitised later and hoped about.
 */
export const httpsUrlSchema = z
  .string()
  .trim()
  .url('Enter a full URL')
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'The URL must start with https://');

/**
 * What the applicant may send.
 *
 * Name and email are deliberately absent: the form shows them read-only from
 * the session, and the server reads them from `req.user`. Accepting them here
 * would let an applicant apply under someone else's name.
 */
export const instructorApplicationInputSchema = z.object({
  professionalTitle: z
    .string()
    .trim()
    .min(3, 'Add the title learners will see')
    .max(120, 'Keep the title under 120 characters'),
  expertise: z
    .array(expertiseTagSchema)
    .min(EXPERTISE_MIN, 'Add at least one area of expertise')
    .max(EXPERTISE_MAX, `Add at most ${EXPERTISE_MAX} topics`)
    .refine(
      (tags) => new Set(tags.map((tag) => tag.toLowerCase())).size === tags.length,
      'Each topic can only be listed once',
    ),
  experience: z
    .string()
    .trim()
    .min(EXPERIENCE_MIN, `Tell us a bit more — at least ${EXPERIENCE_MIN} characters`)
    .max(EXPERIENCE_MAX, `Keep this under ${EXPERIENCE_MAX} characters`),
  biography: z
    .string()
    .trim()
    .min(BIOGRAPHY_MIN, `Write at least ${BIOGRAPHY_MIN} characters`)
    .max(BIOGRAPHY_MAX, `Keep your biography under ${BIOGRAPHY_MAX} characters`),
  motivation: z
    .string()
    .trim()
    .min(MOTIVATION_MIN, `Tell us a bit more — at least ${MOTIVATION_MIN} characters`)
    .max(MOTIVATION_MAX, `Keep this under ${MOTIVATION_MAX} characters`),
  /** The storage key of an uploaded photo, not a URL the client chose. */
  profilePhotoKey: emptyToUndefined(z.string().trim().max(512)),
  portfolioUrl: emptyToUndefined(httpsUrlSchema),
});
export type InstructorApplicationInput = z.infer<typeof instructorApplicationInputSchema>;

/** Editing a pending application: the same fields, all optional. */
export const instructorApplicationUpdateSchema = instructorApplicationInputSchema.partial();
export type InstructorApplicationUpdateInput = z.infer<
  typeof instructorApplicationUpdateSchema
>;

export const approveApplicationSchema = z.object({
  /** Optional on approval; the applicant sees it if given. */
  reason: emptyToUndefined(z.string().trim().max(1000)),
});
export type ApproveApplicationInput = z.infer<typeof approveApplicationSchema>;

export const rejectApplicationSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'A reason is required. The applicant will see it.')
    .max(1000, 'Keep the reason under 1000 characters'),
});
export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;

export const applicationNoteSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, 'Write a note')
    .max(2000, 'Keep the note under 2000 characters'),
});
export type ApplicationNoteInput = z.infer<typeof applicationNoteSchema>;

export const suspendInstructorSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'A reason is required. The instructor will see it.')
    .max(1000, 'Keep the reason under 1000 characters'),
});
export type SuspendInstructorInput = z.infer<typeof suspendInstructorSchema>;

export const reinstateInstructorSchema = z.object({
  reason: emptyToUndefined(z.string().trim().max(1000)),
});
export type ReinstateInstructorInput = z.infer<typeof reinstateInstructorSchema>;

// --- application queries ---------------------------------------------------

export const adminApplicationQuerySchema = paginationQuerySchema.extend({
  search: emptyToUndefined(z.string().trim().max(120)),
  status: emptyToUndefined(z.enum(INSTRUCTOR_APPLICATION_STATUSES)),
  sort: z.enum(['oldest', 'newest', 'applicant']).default('oldest'),
});
export type AdminApplicationQuery = z.infer<typeof adminApplicationQuerySchema>;

export const adminInstructorQuerySchema = paginationQuerySchema.extend({
  search: emptyToUndefined(z.string().trim().max(120)),
  status: emptyToUndefined(z.enum(INSTRUCTOR_PROFILE_STATUSES)),
});
export type AdminInstructorQuery = z.infer<typeof adminInstructorQuerySchema>;

// --- application responses -------------------------------------------------

export const applicationEventSchema = z.object({
  id: uuidSchema,
  action: z.enum(INSTRUCTOR_APPLICATION_ACTIONS),
  fromStatus: z.enum(INSTRUCTOR_APPLICATION_STATUSES).nullable(),
  toStatus: z.enum(INSTRUCTOR_APPLICATION_STATUSES).nullable(),
  reason: z.string().nullable(),
  /** Admin-only; the applicant's view of this list never carries it. */
  internalNote: z.string().nullable().optional(),
  actor: z.object({ id: uuidSchema, name: z.string(), isSelf: z.boolean() }),
  createdAt: z.string(),
});
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;

export const instructorApplicationSchema = z.object({
  id: uuidSchema,
  professionalTitle: z.string(),
  expertise: z.array(z.string()),
  experience: z.string(),
  biography: z.string(),
  motivation: z.string(),
  profilePhotoUrl: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
  status: z.enum(INSTRUCTOR_APPLICATION_STATUSES),
  submittedAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  updatedAt: z.string(),
});
export type InstructorApplication = z.infer<typeof instructorApplicationSchema>;

/**
 * The applicant's own view.
 *
 * `status` here is the *derived* view status, which folds in two things the
 * application row cannot express on its own: never having applied, and being
 * a suspended instructor.
 */
export const myApplicationSchema = z.object({
  status: z.enum(INSTRUCTOR_APPLICATION_VIEW_STATUSES),
  application: instructorApplicationSchema.nullable(),
  history: z.array(applicationEventSchema),
  /** Present when rejected and the cooldown has not elapsed. */
  canReapplyAt: z.string().nullable(),
  canReapplyNow: z.boolean(),
  /** Present when the caller is a suspended instructor. */
  suspension: z
    .object({ reason: z.string().nullable(), since: z.string() })
    .nullable(),
  instructorSince: z.string().nullable(),
  /** Reassurance copy on every state: the learner side is untouched. */
  enrolledCourseCount: z.number().int().min(0),
});
export type MyApplication = z.infer<typeof myApplicationSchema>;

export const adminApplicationListItemSchema = z.object({
  id: uuidSchema,
  applicant: z.object({
    id: uuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
  }),
  professionalTitle: z.string(),
  expertise: z.array(z.string()),
  status: z.enum(INSTRUCTOR_APPLICATION_STATUSES),
  submittedAt: z.string(),
});
export type AdminApplicationListItem = z.infer<typeof adminApplicationListItemSchema>;

export const adminApplicationDetailSchema = instructorApplicationSchema.extend({
  applicant: z.object({
    id: uuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    role: z.string(),
    memberSince: z.string(),
    enrolledCourses: z.number().int().min(0),
    completedCourses: z.number().int().min(0),
    pastApplications: z.number().int().min(0),
  }),
  history: z.array(applicationEventSchema),
  decidedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
});
export type AdminApplicationDetail = z.infer<typeof adminApplicationDetailSchema>;

export const applicationCountsSchema = z.object({
  PENDING: z.number().int().min(0),
  APPROVED: z.number().int().min(0),
  REJECTED: z.number().int().min(0),
  WITHDRAWN: z.number().int().min(0),
  ALL: z.number().int().min(0),
});
export type ApplicationCounts = z.infer<typeof applicationCountsSchema>;

export const adminInstructorListItemSchema = z.object({
  userId: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  displayName: z.string(),
  title: z.string(),
  photoUrl: z.string().nullable(),
  status: z.enum(INSTRUCTOR_PROFILE_STATUSES),
  publishedCourses: z.number().int().min(0),
  totalCourses: z.number().int().min(0),
  learners: z.number().int().min(0),
  instructorSince: z.string(),
  suspendedAt: z.string().nullable(),
  suspensionReason: z.string().nullable(),
});
export type AdminInstructorListItem = z.infer<typeof adminInstructorListItemSchema>;

// ---------------------------------------------------------------------------
// Instructor profile
// ---------------------------------------------------------------------------

export const instructorProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(2, 'Add a display name').max(120),
  title: z.string().trim().min(3, 'Add your professional title').max(120),
  bio: z
    .string()
    .trim()
    .min(BIOGRAPHY_MIN, `Write at least ${BIOGRAPHY_MIN} characters`)
    .max(BIOGRAPHY_MAX),
  photoKey: emptyToUndefined(z.string().trim().max(512)),
});
export type InstructorProfileUpdateInput = z.infer<typeof instructorProfileUpdateSchema>;

/** What the public catalog exposes about an instructor, and nothing more. */
export const publicInstructorSchema = z.object({
  displayName: z.string(),
  title: z.string(),
  photoUrl: z.string().nullable(),
});
export type PublicInstructor = z.infer<typeof publicInstructorSchema>;

export const instructorProfileSchema = publicInstructorSchema.extend({
  userId: uuidSchema,
  bio: z.string(),
  status: z.enum(INSTRUCTOR_PROFILE_STATUSES),
  approvedAt: z.string(),
  suspendedAt: z.string().nullable(),
  suspensionReason: z.string().nullable(),
});
export type InstructorProfile = z.infer<typeof instructorProfileSchema>;

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export const publishCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
  /** Lessons responsible for a failure, so the UI can deep-link to them. */
  lessonIds: z.array(uuidSchema).optional(),
});
export type PublishCheck = z.infer<typeof publishCheckSchema>;

export const publishChecklistSchema = z.object({
  courseId: uuidSchema,
  checks: z.array(publishCheckSchema),
  passing: z.number().int().min(0),
  total: z.number().int().min(0),
  canPublish: z.boolean(),
});
export type PublishChecklist = z.infer<typeof publishChecklistSchema>;

// ---------------------------------------------------------------------------
// Instructor courses
// ---------------------------------------------------------------------------

export const instructorCourseQuerySchema = paginationQuerySchema.extend({
  search: emptyToUndefined(z.string().trim().max(120)),
  status: emptyToUndefined(z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])),
  sort: z.enum(INSTRUCTOR_COURSE_SORTS).default('newest'),
});
export type InstructorCourseQuery = z.infer<typeof instructorCourseQuerySchema>;

/** A course card in the instructor workspace: catalog fields plus teaching stats. */
export const instructorCourseCardSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  category: z.string(),
  thumbnailUrl: z.string(),
  difficulty: z.enum(DIFFICULTIES),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  lessonCount: z.number().int().min(0),
  estimatedDuration: z.number().int().min(0),
  enrolledLearners: z.number().int().min(0),
  /** Enrollments in the last 7 days — the "+14" on the artifact's card. */
  newEnrollments7d: z.number().int().min(0),
  /** `null` when nobody is enrolled, which the card renders as a dash. */
  averageProgress: z.number().int().min(0).max(100).nullable(),
  lessonsNeedingVideo: z.number().int().min(0),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
});
export type InstructorCourseCard = z.infer<typeof instructorCourseCardSchema>;

export const instructorDashboardSchema = z.object({
  stats: z.object({
    totalCourses: z.number().int().min(0),
    publishedCourses: z.number().int().min(0),
    draftCourses: z.number().int().min(0),
    archivedCourses: z.number().int().min(0),
    enrolledLearners: z.number().int().min(0),
    newEnrollments7d: z.number().int().min(0),
    lessonsCompleted: z.number().int().min(0),
    averageCompletionRate: z.number().int().min(0).max(100),
  }),
  courses: z.array(instructorCourseCardSchema),
  /** The draft closest to being publishable, for the "Finish your draft" card. */
  draftNudge: z
    .object({
      courseId: uuidSchema,
      title: z.string(),
      passing: z.number().int().min(0),
      total: z.number().int().min(0),
      summary: z.string(),
    })
    .nullable(),
});
export type InstructorDashboard = z.infer<typeof instructorDashboardSchema>;

export const INSTRUCTOR_ACTIVITY_KINDS = [
  'ENROLLMENT',
  'LESSON_COMPLETED',
  'MILESTONE',
  'COURSE_EVENT',
] as const;
export type InstructorActivityKind = (typeof INSTRUCTOR_ACTIVITY_KINDS)[number];

export const instructorActivityItemSchema = z.object({
  id: z.string(),
  kind: z.enum(INSTRUCTOR_ACTIVITY_KINDS),
  /** `null` for a course event, which the actor performed themselves. */
  learner: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  courseId: uuidSchema,
  courseTitle: z.string(),
  lessonTitle: z.string().nullable(),
  /** 25 / 50 / 75 / 100 for a milestone. */
  milestone: z.number().int().nullable(),
  courseEventType: z.enum(COURSE_EVENT_TYPES).nullable(),
  occurredAt: z.string(),
});
export type InstructorActivityItem = z.infer<typeof instructorActivityItemSchema>;

export const instructorActivityQuerySchema = paginationQuerySchema.extend({
  kind: emptyToUndefined(z.enum(INSTRUCTOR_ACTIVITY_KINDS)),
  courseId: emptyToUndefined(uuidSchema),
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type InstructorActivityQuery = z.infer<typeof instructorActivityQuerySchema>;

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const courseAnalyticsSchema = z.object({
  courseId: uuidSchema,
  courseTitle: z.string(),
  courseStatus: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  lessonCount: z.number().int().min(0),
  stats: z.object({
    enrolled: z.number().int().min(0),
    active: z.number().int().min(0),
    inactive: z.number().int().min(0),
    completed: z.number().int().min(0),
    completionRate: z.number().int().min(0).max(100),
    averageProgress: z.number().int().min(0).max(100),
    lessonsCompleted: z.number().int().min(0),
    firstEnrollmentAt: z.string().nullable(),
  }),
  /** One point per ISO week, in UTC. */
  enrollmentsOverTime: z.array(
    z.object({ weekStart: z.string(), count: z.number().int().min(0) }),
  ),
  progressDistribution: z.array(
    z.object({
      band: z.enum(PROGRESS_BANDS),
      count: z.number().int().min(0),
      percentage: z.number().int().min(0).max(100),
    }),
  ),
  lessonCompletion: z.array(
    z.object({
      lessonId: uuidSchema,
      order: z.number().int(),
      title: z.string(),
      completed: z.number().int().min(0),
      percentage: z.number().int().min(0).max(100),
    }),
  ),
  activeDays: z.number().int().min(1),
  generatedAt: z.string(),
});
export type CourseAnalytics = z.infer<typeof courseAnalyticsSchema>;

export const courseLearnerQuerySchema = paginationQuerySchema.extend({
  search: emptyToUndefined(z.string().trim().max(120)),
  status: emptyToUndefined(
    z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'INACTIVE']),
  ),
  band: emptyToUndefined(z.enum(PROGRESS_BANDS)),
  sort: z.enum(LEARNER_TABLE_SORTS).default('activity'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type CourseLearnerQuery = z.infer<typeof courseLearnerQuerySchema>;

/**
 * One row of the enrolled-learners table.
 *
 * Deliberately narrow: name, email and progress *in this course*. An
 * instructor has no business knowing a learner's role, account status or
 * what else they are studying, so none of it is in the shape.
 */
export const courseLearnerRowSchema = z.object({
  userId: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  enrolledAt: z.string(),
  progressPercentage: z.number().int().min(0).max(100),
  completedLessons: z.number().int().min(0),
  totalLessons: z.number().int().min(0),
  lastActivityAt: z.string().nullable(),
  enrollmentStatus: z.enum(ENROLLMENT_STATUSES),
  displayStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'INACTIVE']),
});
export type CourseLearnerRow = z.infer<typeof courseLearnerRowSchema>;

export const learnerCourseProgressSchema = z.object({
  learner: z.object({
    userId: uuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
  }),
  course: z.object({
    id: uuidSchema,
    title: z.string(),
    slug: z.string(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
    lessonCount: z.number().int().min(0),
    estimatedDuration: z.number().int().min(0),
    averageProgress: z.number().int().min(0).max(100),
  }),
  enrolledAt: z.string(),
  completedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  progressPercentage: z.number().int().min(0).max(100),
  completedLessons: z.number().int().min(0),
  totalWatchedSeconds: z.number().int().min(0),
  enrollmentStatus: z.enum(ENROLLMENT_STATUSES),
  lessons: z.array(
    z.object({
      lessonId: uuidSchema,
      order: z.number().int(),
      moduleTitle: z.string(),
      title: z.string(),
      durationSeconds: z.number().int().min(0),
      status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']),
      completedAt: z.string().nullable(),
      lastPositionSeconds: z.number().int().min(0),
      updatedAt: z.string().nullable(),
    }),
  ),
  lastWatched: z
    .object({
      lessonId: uuidSchema,
      title: z.string(),
      positionSeconds: z.number().int().min(0),
      durationSeconds: z.number().int().min(0),
      at: z.string(),
    })
    .nullable(),
});
export type LearnerCourseProgress = z.infer<typeof learnerCourseProgressSchema>;

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export const UPLOAD_PURPOSES = [
  'LESSON_VIDEO',
  'COURSE_THUMBNAIL',
  'PROFILE_PHOTO',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const presignUploadSchema = z.object({
  kind: z.enum(MEDIA_KINDS),
  purpose: z.enum(UPLOAD_PURPOSES),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive('The file looks empty'),
  originalName: emptyToUndefined(z.string().trim().max(255)),
  /** Present for lesson and thumbnail uploads; ownership is checked against it. */
  courseId: emptyToUndefined(uuidSchema),
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

export const presignedUploadSchema = z.object({
  assetId: uuidSchema,
  /** Where the browser PUTs the bytes. */
  uploadUrl: z.string(),
  method: z.enum(['PUT', 'POST']),
  headers: z.record(z.string()),
  storageKey: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type PresignedUpload = z.infer<typeof presignedUploadSchema>;

export const completeUploadSchema = z.object({
  /**
   * What the browser read from `loadedmetadata`. Treated as a hint only: the
   * server re-derives the duration with ffprobe where it can, and this value
   * is never trusted on its own, because completion tracking divides by it.
   */
  durationSeconds: z.number().int().positive().max(60 * 60 * 24).optional(),
});
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

export const mediaAssetSchema = z.object({
  id: uuidSchema,
  kind: z.enum(MEDIA_KINDS),
  status: z.enum(MEDIA_STATUSES),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
  durationSeconds: z.number().int().nullable(),
  originalName: z.string().nullable(),
  /** A short-lived signed URL, minted per request. Never a durable address. */
  url: z.string().nullable(),
  createdAt: z.string(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

// ---------------------------------------------------------------------------
// Course preview
// ---------------------------------------------------------------------------

/**
 * The learner view of a course, plus the banner state the preview needs.
 *
 * Declared in `course.ts` rather than here would be circular, so the preview
 * flag lives on its own and `CoursePreview` is assembled in `course.ts`.
 */
export const previewStateSchema = z.object({
  isPreview: z.literal(true),
  courseStatus: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  /** Drives "Draft · not in catalog" beside the banner. */
  inCatalog: z.boolean(),
  /** Always false. Stated explicitly so the player can disable tracking. */
  progressTracked: z.literal(false),
});
export type PreviewState = z.infer<typeof previewStateSchema>;
