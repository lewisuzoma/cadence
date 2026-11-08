import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  activityItemSchema,
  adminApplicationDetailSchema,
  adminApplicationListItemSchema,
  adminApplicationQuerySchema,
  adminCourseQuerySchema,
  adminInstructorListItemSchema,
  adminInstructorQuerySchema,
  applicationNoteSchema,
  approveApplicationSchema,
  adminLearnerDetailSchema,
  adminUserQuerySchema,
  adminUserRowSchema,
  adminUserUpdateSchema,
  changePasswordSchema,
  completeLessonSchema,
  courseDetailSchema,
  courseDraftStateSchema,
  courseInputSchema,
  courseQuerySchema,
  courseStatusUpdateSchema,
  courseSummarySchema,
  courseUpdateSchema,
  enrollmentQuerySchema,
  enrollmentSchema,
  enrollmentWithCourseSchema,
  courseAnalyticsSchema,
  courseLearnerQuerySchema,
  courseLearnerRowSchema,
  forgotPasswordSchema,
  instructorActivityItemSchema,
  instructorActivityQuerySchema,
  instructorApplicationInputSchema,
  instructorApplicationUpdateSchema,
  instructorCourseCardSchema,
  instructorCourseQuerySchema,
  instructorDashboardSchema,
  instructorProfileSchema,
  instructorProfileUpdateSchema,
  learnerCourseProgressSchema,
  learnerDashboardSchema,
  lessonDetailSchema,
  lessonInputSchema,
  lessonSummarySchema,
  loginSchema,
  mediaAssetSchema,
  moduleInputSchema,
  partTargetsRequestSchema,
  partTargetsResponseSchema,
  myApplicationSchema,
  notificationListSchema,
  notificationQuerySchema,
  presignUploadSchema,
  presignedUploadSchema,
  progressResultSchema,
  publishChecklistSchema,
  publishCourseSchema,
  registerSchema,
  reinstateInstructorSchema,
  rejectApplicationSchema,
  reorderLessonsSchema,
  resetPasswordSchema,
  saveProgressSchema,
  suspendInstructorSchema,
  uploadStatusSchema,
  adminDashboardSchema,
  userSchema,
} from '@cadence/shared';

/**
 * The OpenAPI document is generated from the very same Zod schemas the server
 * validates with and the client's forms use.  There is no second description
 * of the API to drift out of date.
 */
extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const cookieAuth = registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'cadence_access',
  description:
    'httpOnly access cookie, set by POST /auth/login. Mutating requests must also send the X-CSRF-Token header matching the csrf_token cookie.',
});

/** Wraps a payload in the API's success envelope. */
function success<T extends z.ZodTypeAny>(data: T, withMeta = false) {
  const shape: z.ZodRawShape = {
    success: z.literal(true),
    message: z.string(),
    data,
  };
  if (withMeta) {
    shape.meta = z.object({
      page: z.number(),
      pageSize: z.number(),
      total: z.number(),
      totalPages: z.number(),
    });
  }
  return z.object(shape);
}

const failure = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string(),
  errors: z.record(z.array(z.string())).optional(),
});

const errorResponses = {
  400: { description: 'Validation failed', content: { 'application/json': { schema: failure } } },
  401: { description: 'Not authenticated', content: { 'application/json': { schema: failure } } },
  403: { description: 'Forbidden / CSRF failure', content: { 'application/json': { schema: failure } } },
  404: { description: 'Not found', content: { 'application/json': { schema: failure } } },
  409: { description: 'Conflict', content: { 'application/json': { schema: failure } } },
  422: { description: 'Business rule violation', content: { 'application/json': { schema: failure } } },
  429: { description: 'Rate limited', content: { 'application/json': { schema: failure } } },
};

const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { 'application/json': { schema } },
});

function get(path: string, config: {
  tag: string;
  summary: string;
  response: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  secure?: boolean;
  list?: boolean;
}) {
  registry.registerPath({
    method: 'get',
    path,
    tags: [config.tag],
    summary: config.summary,
    ...(config.secure ? { security: [{ [cookieAuth.name]: [] }] } : {}),
    request: config.query ? { query: config.query as never } : {},
    responses: {
      200: { description: config.summary, ...json(success(config.response, config.list)) },
      ...errorResponses,
    },
  });
}

function mutate(
  method: 'post' | 'patch' | 'put' | 'delete',
  path: string,
  config: {
    tag: string;
    summary: string;
    body?: z.ZodTypeAny;
    response?: z.ZodTypeAny;
    status?: number;
    secure?: boolean;
  },
) {
  registry.registerPath({
    method,
    path,
    tags: [config.tag],
    summary: config.summary,
    ...(config.secure === false ? {} : { security: [{ [cookieAuth.name]: [] }] }),
    request: config.body ? { body: json(config.body) } : {},
    responses: {
      [config.status ?? 200]: config.response
        ? { description: config.summary, ...json(success(config.response)) }
        : { description: config.summary },
      ...errorResponses,
    },
  });
}

// --- auth ------------------------------------------------------------------
const authUser = z.object({ user: userSchema });
mutate('post', '/auth/register', { tag: 'Auth', summary: 'Create a learner account', body: registerSchema, response: authUser, status: 201, secure: false });
mutate('post', '/auth/login', { tag: 'Auth', summary: 'Sign in', body: loginSchema, response: authUser, secure: false });
mutate('post', '/auth/refresh', { tag: 'Auth', summary: 'Rotate the refresh token', response: authUser, secure: false });
mutate('post', '/auth/forgot-password', { tag: 'Auth', summary: 'Request a password reset link (always 200, to avoid disclosing whether the account exists)', body: forgotPasswordSchema, response: z.object({ success: z.boolean() }), secure: false });
mutate('post', '/auth/reset-password', { tag: 'Auth', summary: 'Set a new password from an emailed token (revokes every refresh token; does not sign in)', body: resetPasswordSchema, response: z.object({ success: z.boolean() }), secure: false });
mutate('post', '/auth/logout', { tag: 'Auth', summary: 'Sign out and revoke the refresh token', response: z.object({ success: z.boolean() }) });
get('/auth/me', { tag: 'Auth', summary: 'The signed-in user', response: authUser, secure: true });
mutate('post', '/auth/change-password', { tag: 'Auth', summary: 'Change password (revokes other sessions)', body: changePasswordSchema, response: authUser });

// --- catalog ---------------------------------------------------------------
get('/courses', { tag: 'Catalog', summary: 'Published courses', response: z.array(courseSummarySchema), query: courseQuerySchema, list: true });
get('/courses/categories', { tag: 'Catalog', summary: 'Categories in the catalog', response: z.array(z.string()) });
get('/courses/{idOrSlug}', { tag: 'Catalog', summary: 'Course detail with modules and lessons', response: courseDetailSchema });
get('/courses/{courseId}/lessons', { tag: 'Catalog', summary: 'Lessons of a course', response: z.array(lessonSummarySchema) });
get('/lessons/{id}', { tag: 'Catalog', summary: 'Lesson detail for the player', response: lessonDetailSchema });

// --- enrollment ------------------------------------------------------------
mutate('post', '/courses/{courseId}/enroll', { tag: 'Enrollment', summary: 'Enroll (idempotent: 201 new, 200 existing)', response: enrollmentSchema, status: 201 });
get('/courses/{courseId}/enrollment', { tag: 'Enrollment', summary: "The caller's enrollment", response: enrollmentSchema, secure: true });
mutate('delete', '/courses/{courseId}/enroll', { tag: 'Enrollment', summary: 'Leave a course (progress is kept)', response: enrollmentSchema });
get('/enrollments/me', { tag: 'Enrollment', summary: "The caller's enrollments", response: z.array(enrollmentWithCourseSchema), query: enrollmentQuerySchema, secure: true, list: true });

// --- progress --------------------------------------------------------------
get('/lessons/{lessonId}/progress', { tag: 'Progress', summary: 'Progress on one lesson', response: z.object({ lessonId: z.string(), courseId: z.string(), durationSeconds: z.number(), progress: z.any() }), secure: true });
mutate('put', '/lessons/{lessonId}/progress', { tag: 'Progress', summary: 'Save a watch position', body: saveProgressSchema, response: progressResultSchema });
mutate('post', '/lessons/{lessonId}/complete', { tag: 'Progress', summary: 'Mark a lesson complete (idempotent)', body: completeLessonSchema, response: progressResultSchema });

// --- instructor applications (applicant) -----------------------------------
mutate('post', '/instructor-applications', { tag: 'Instructor applications', summary: 'Apply to become an instructor. Name and email come from the session, never the body.', body: instructorApplicationInputSchema, response: myApplicationSchema, status: 201 });
get('/instructor-applications/me', { tag: 'Instructor applications', summary: "The caller's application status, derived (NOT_APPLIED / PENDING / APPROVED / REJECTED / WITHDRAWN / SUSPENDED) with the reapply cooldown and the history they may see", response: myApplicationSchema, secure: true });
mutate('patch', '/instructor-applications/me', { tag: 'Instructor applications', summary: 'Edit a PENDING application. 409 if it was decided in the meantime.', body: instructorApplicationUpdateSchema, response: myApplicationSchema });
mutate('post', '/instructor-applications/me/withdraw', { tag: 'Instructor applications', summary: 'Withdraw a PENDING application. The row is kept as history.', response: myApplicationSchema });

// --- instructor applications (admin review) --------------------------------
get('/admin/instructor-applications', { tag: 'Admin — instructors', summary: 'The review queue, oldest pending first. `meta.counts` carries the per-status tab counts.', response: z.array(adminApplicationListItemSchema), query: adminApplicationQuerySchema, secure: true, list: true });
get('/admin/instructor-applications/{id}', { tag: 'Admin — instructors', summary: "One application with the applicant's account summary and the full decision history, internal notes included", response: adminApplicationDetailSchema, secure: true });
mutate('post', '/admin/instructor-applications/{id}/approve', { tag: 'Admin — instructors', summary: 'Approve: in one transaction the application becomes APPROVED, the role becomes INSTRUCTOR, a profile is created, an event is recorded and the applicant is notified. 409 if already decided; 403 on your own application.', body: approveApplicationSchema, response: adminApplicationDetailSchema });
mutate('post', '/admin/instructor-applications/{id}/reject', { tag: 'Admin — instructors', summary: 'Reject with a required reason. The role is unchanged and the applicant may reapply after the cooldown.', body: rejectApplicationSchema, response: adminApplicationDetailSchema });
mutate('post', '/admin/instructor-applications/{id}/notes', { tag: 'Admin — instructors', summary: 'Add an internal note. Admins only; never shown to the applicant.', body: applicationNoteSchema, response: adminApplicationDetailSchema });

// --- instructor management -------------------------------------------------
get('/admin/instructors', { tag: 'Admin — instructors', summary: 'Instructors with their course and learner counts', response: z.array(adminInstructorListItemSchema), query: adminInstructorQuerySchema, secure: true, list: true });
mutate('post', '/admin/instructors/{id}/suspend', { tag: 'Admin — instructors', summary: 'Suspend an instructor with a required reason. Teaching stops on their next request; their own learning, enrollments and progress are untouched.', body: suspendInstructorSchema, response: z.object({ userId: z.string(), status: z.string() }) });
mutate('post', '/admin/instructors/{id}/reinstate', { tag: 'Admin — instructors', summary: 'Restore a suspended instructor', body: reinstateInstructorSchema, response: z.object({ userId: z.string(), status: z.string() }) });

// --- instructor workspace --------------------------------------------------
get('/instructor/dashboard', { tag: 'Instructor', summary: 'Teaching overview: stat cards, the course rail and the draft nudge. Scoped to the caller\u2019s own courses.', response: instructorDashboardSchema, secure: true });
get('/instructor/courses', { tag: 'Instructor', summary: "The caller's courses with teaching statistics. `meta.counts` carries the tab counts.", response: z.array(instructorCourseCardSchema), query: instructorCourseQuerySchema, secure: true, list: true });
get('/instructor/activity', { tag: 'Instructor', summary: 'Enrollments, lesson completions, progress milestones and course events, merged from real records', response: z.array(instructorActivityItemSchema), query: instructorActivityQuerySchema, secure: true, list: true });
mutate('post', '/instructor/courses', { tag: 'Instructor', summary: 'Create a course. It starts as a DRAFT and the owner is taken from the session.', body: courseInputSchema, response: courseSummarySchema, status: 201 });
get('/instructor/courses/{id}', { tag: 'Instructor', summary: "One of the caller's courses, at any status. Another instructor's course answers 404, not 403.", response: courseDetailSchema, secure: true });
get('/instructor/courses/{id}/publish-checklist', { tag: 'Instructor', summary: 'Every publishing rule and whether it passes', response: publishChecklistSchema, secure: true });
get('/instructor/courses/{id}/draft-state', { tag: 'Instructor', summary: 'How the draft differs from the version learners see, plus the published history. The Course row is the draft; a CourseVersion is what the catalog shows.', response: courseDraftStateSchema, secure: true });
mutate('patch', '/instructor/courses/{id}', { tag: 'Instructor', summary: 'Update a course. Owner and status cannot be set through this path.', body: courseUpdateSchema, response: courseSummarySchema });
mutate('delete', '/instructor/courses/{id}', { tag: 'Instructor', summary: 'Delete a course that has no enrollments. 409 with "archive instead" otherwise.' });
mutate('post', '/instructor/courses/{id}/publish', { tag: 'Instructor', summary: 'Freeze the draft as a new version and point learners at it. The same verb for a first release and for shipping edits to a live course. 422 lists every failing checklist rule if it is not ready.', body: publishCourseSchema, response: courseSummarySchema });
mutate('post', '/instructor/courses/{id}/unpublish', { tag: 'Instructor', summary: 'Move back to DRAFT. Enrollments and progress are untouched; new enrollments are blocked.', response: courseSummarySchema });
mutate('post', '/instructor/courses/{id}/archive', { tag: 'Instructor', summary: 'Archive. Enrolled learners keep access; the course leaves the catalog.', response: courseSummarySchema });
mutate('post', '/instructor/courses/{id}/modules', { tag: 'Instructor', summary: 'Add a module', body: moduleInputSchema, response: z.any(), status: 201 });
mutate('post', '/instructor/modules/{id}/lessons', { tag: 'Instructor', summary: 'Add a lesson', body: lessonInputSchema, response: lessonSummarySchema, status: 201 });
mutate('patch', '/instructor/modules/{id}/lessons/reorder', { tag: 'Instructor', summary: 'Reorder a module\u2019s lessons in one transaction. The submitted ids must be exactly that module\u2019s lessons.', body: reorderLessonsSchema, response: z.array(lessonSummarySchema) });

// --- instructor profile ----------------------------------------------------
get('/instructor/profile', { tag: 'Instructor', summary: "The caller's instructor profile", response: instructorProfileSchema, secure: true });
mutate('patch', '/instructor/profile', { tag: 'Instructor', summary: 'Update the public instructor profile', body: instructorProfileUpdateSchema, response: instructorProfileSchema });

// --- analytics and learner monitoring --------------------------------------
get('/instructor/courses/{id}/analytics', { tag: 'Instructor analytics', summary: 'Course analytics: stat cards and the four chart series, all from database aggregates', response: courseAnalyticsSchema, secure: true });
get('/instructor/courses/{id}/learners', { tag: 'Instructor analytics', summary: 'Enrolled learners with server-side search, filters, sorting and pagination. Name, email and progress in this course only.', response: z.array(courseLearnerRowSchema), query: courseLearnerQuerySchema, secure: true, list: true });
get('/instructor/courses/{id}/learners/{userId}/progress', { tag: 'Instructor analytics', summary: "One learner's progress in this course. 404 if they are not enrolled in it.", response: learnerCourseProgressSchema, secure: true });

// --- uploads ---------------------------------------------------------------
mutate('post', '/uploads/presign', { tag: 'Uploads', summary: 'Ask for a signed upload URL. Checks ownership, the MIME allow-list and the size limit before issuing one.', body: presignUploadSchema, response: presignedUploadSchema, status: 201 });
mutate('post', '/uploads/{id}/complete', { tag: 'Uploads', summary: "Confirm an upload. The server verifies the stored object's size and its real type from its magic bytes, extracts the duration and marks it READY.", response: mediaAssetSchema });
mutate('delete', '/uploads/{id}', { tag: 'Uploads', summary: 'Cancel an upload, delete the stored object and abort any multipart upload still in flight' });
get('/uploads/{id}/status', { tag: 'Uploads', summary: 'Which parts of a resumable upload have already landed. Answered from the storage provider, which is the only source that cannot be stale.', response: uploadStatusSchema, secure: true });
mutate('post', '/uploads/{id}/parts', { tag: 'Uploads', summary: 'Signed targets for a batch of parts. Batched because a 2 GB file at an 8 MB part size is 256 parts, and 256 extra round trips would be most of the latency.', body: partTargetsRequestSchema, response: partTargetsResponseSchema });
mutate('put', '/uploads/multipart/{uploadId}/parts/{partNumber}', { tag: 'Uploads', summary: "Stage one part (local storage driver only; with S3 the browser PUTs parts straight to the bucket)", response: z.object({ partNumber: z.number(), etag: z.string(), sizeBytes: z.number() }) });

// --- notifications ---------------------------------------------------------
get('/notifications', { tag: 'Notifications', summary: "The caller's notifications, newest first, with an unread count", response: notificationListSchema, query: notificationQuerySchema, secure: true, list: true });
mutate('post', '/notifications/{id}/read', { tag: 'Notifications', summary: 'Mark one notification read', response: z.object({ unreadCount: z.number() }) });
mutate('post', '/notifications/read-all', { tag: 'Notifications', summary: 'Mark every notification read', response: z.object({ updated: z.number(), unreadCount: z.number() }) });

// --- dashboards ------------------------------------------------------------
get('/dashboard/learner', { tag: 'Dashboards', summary: 'Learner dashboard aggregates', response: learnerDashboardSchema, secure: true });
get('/dashboard/admin', { tag: 'Dashboards', summary: 'Admin dashboard aggregates', response: adminDashboardSchema, secure: true });
get('/activity/me', { tag: 'Dashboards', summary: "The caller's activity feed", response: z.array(activityItemSchema), secure: true, list: true });

// --- admin -----------------------------------------------------------------
get('/admin/courses', { tag: 'Admin · content', summary: 'All courses, any status', response: z.array(courseSummarySchema), query: adminCourseQuerySchema, secure: true, list: true });
mutate('post', '/admin/courses', { tag: 'Admin · content', summary: 'Create a course (starts as DRAFT)', body: courseInputSchema, response: courseSummarySchema, status: 201 });
mutate('patch', '/admin/courses/{id}', { tag: 'Admin · content', summary: 'Update a course', body: courseUpdateSchema, response: courseSummarySchema });
mutate('patch', '/admin/courses/{id}/status', { tag: 'Admin · content', summary: 'Publish, unpublish or archive', body: courseStatusUpdateSchema, response: courseSummarySchema });
mutate('delete', '/admin/courses/{id}', { tag: 'Admin · content', summary: 'Delete a course (409 when learners are enrolled)', status: 204 });
mutate('post', '/admin/courses/{id}/modules', { tag: 'Admin · content', summary: 'Add a module', body: moduleInputSchema, status: 201, response: z.any() });
mutate('post', '/admin/modules/{id}/lessons', { tag: 'Admin · content', summary: 'Add a lesson', body: lessonInputSchema, status: 201, response: z.any() });
mutate('patch', '/admin/modules/{id}/lessons/reorder', { tag: 'Admin · content', summary: 'Reorder a module’s lessons (transactional)', body: reorderLessonsSchema, response: z.array(lessonSummarySchema) });
get('/admin/users', { tag: 'Admin · people', summary: 'Learners, paginated and searchable', response: z.array(adminUserRowSchema), query: adminUserQuerySchema, secure: true, list: true });
get('/admin/users/{id}', { tag: 'Admin · people', summary: 'One learner with progress', response: adminLearnerDetailSchema, secure: true });
mutate('patch', '/admin/users/{id}', { tag: 'Admin · people', summary: 'Activate or deactivate a learner', body: adminUserUpdateSchema, response: adminUserRowSchema });
get('/admin/activity', { tag: 'Admin · people', summary: 'Platform-wide activity feed', response: z.array(activityItemSchema), secure: true, list: true });

// --- health ----------------------------------------------------------------
get('/health', {
  tag: 'System',
  summary: 'Liveness + database reachability',
  response: z.object({ status: z.string(), database: z.string(), uptime: z.number() }),
});

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Cadence API',
      version: '1.0.0',
      description: [
        'A learning platform API.',
        '',
        'Authentication is cookie based: `POST /auth/login` sets an httpOnly',
        'access cookie (15 minutes), a path-scoped httpOnly refresh cookie',
        '(7 days, rotated on use) and a readable `csrf_token` cookie. Every',
        'POST / PUT / PATCH / DELETE must echo that value in the',
        '`X-CSRF-Token` header.',
        '',
        'All responses use one envelope: `{ success, message, data, meta? }`',
        'or `{ success: false, message, code, errors? }`.',
      ].join('\n'),
    },
    servers: [{ url: '/api/v1', description: 'This server' }],
    tags: [
      { name: 'Auth' },
      { name: 'Catalog' },
      { name: 'Enrollment' },
      { name: 'Progress' },
      { name: 'Dashboards' },
      { name: 'Admin · content' },
      { name: 'Admin · people' },
      { name: 'System' },
    ],
  });
}
