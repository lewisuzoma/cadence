import { Router } from 'express';
import {
  activityQuerySchema,
  adminApplicationQuerySchema,
  adminCourseQuerySchema,
  adminInstructorQuerySchema,
  applicationNoteSchema,
  approveApplicationSchema,
  adminUserQuerySchema,
  adminUserUpdateSchema,
  completeLessonSchema,
  completeUploadSchema,
  courseInputSchema,
  courseQuerySchema,
  courseStatusUpdateSchema,
  courseUpdateSchema,
  enrollmentQuerySchema,
  idParamSchema,
  instructorApplicationInputSchema,
  instructorApplicationUpdateSchema,
  lessonInputSchema,
  lessonUpdateSchema,
  moduleInputSchema,
  moduleUpdateSchema,
  notificationQuerySchema,
  paginationQuerySchema,
  partTargetsRequestSchema,
  presignUploadSchema,
  progressQuerySchema,
  reinstateInstructorSchema,
  rejectApplicationSchema,
  reorderLessonsSchema,
  saveProgressSchema,
  suspendInstructorSchema,
} from '@cadence/shared';
import {
  authenticate,
  optionalAuthenticate,
  requirePermission,
  requireRole,
} from './middlewares/authenticate.js';
import { csrfProtection } from './middlewares/csrf.js';
import { uploadLimiter } from './middlewares/rateLimit.js';
import { asyncHandler } from './middlewares/errorHandler.js';
import { validate } from './middlewares/validate.js';
import { adminController } from './modules/admin/admin.controller.js';
import { applicationsController } from './modules/applications/applications.controller.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { coursesController } from './modules/courses/courses.controller.js';
import { dashboardController } from './modules/dashboard/dashboard.controller.js';
import { enrollmentController } from './modules/enrollment/enrollment.controller.js';
import { instructorRouter } from './modules/instructor/instructor.routes.js';
import { lessonsController } from './modules/lessons/lessons.controller.js';
import { notificationsController } from './modules/notifications/notifications.controller.js';
import { uploadsController } from './modules/uploads/uploads.controller.js';
import { progressController } from './modules/progress/progress.controller.js';

/**
 * Every route in one file, so the surface area of the API — and which guard
 * protects what — can be read at a glance.
 *
 * Guard order is always: authenticate → CSRF (mutations) → role → validate.
 */
export const apiRouter = Router();

// --- catalog (public, enriched when signed in) -----------------------------

apiRouter.get(
  '/courses',
  optionalAuthenticate,
  validate({ query: courseQuerySchema }),
  asyncHandler(coursesController.list),
);

apiRouter.get('/courses/categories', asyncHandler(coursesController.categories));

apiRouter.get(
  '/courses/:courseId/lessons',
  optionalAuthenticate,
  asyncHandler(lessonsController.listForCourse),
);

apiRouter.get(
  '/courses/:idOrSlug',
  optionalAuthenticate,
  asyncHandler(coursesController.detail),
);

apiRouter.get('/lessons/:id', optionalAuthenticate, asyncHandler(lessonsController.detail));

// --- enrollment (learner) --------------------------------------------------

apiRouter.post(
  '/courses/:courseId/enroll',
  authenticate,
  csrfProtection,
  asyncHandler(enrollmentController.enroll),
);

apiRouter.get(
  '/courses/:courseId/enrollment',
  authenticate,
  asyncHandler(enrollmentController.forCourse),
);

apiRouter.delete(
  '/courses/:courseId/enroll',
  authenticate,
  csrfProtection,
  asyncHandler(enrollmentController.cancel),
);

apiRouter.get(
  '/enrollments/me',
  authenticate,
  validate({ query: enrollmentQuerySchema }),
  asyncHandler(enrollmentController.listMine),
);

// --- progress (learner, always scoped to req.user) -------------------------

apiRouter.get(
  '/lessons/:lessonId/progress',
  authenticate,
  asyncHandler(progressController.getForLesson),
);

apiRouter.put(
  '/lessons/:lessonId/progress',
  authenticate,
  csrfProtection,
  validate({ body: saveProgressSchema }),
  asyncHandler(progressController.save),
);

apiRouter.post(
  '/lessons/:lessonId/complete',
  authenticate,
  csrfProtection,
  validate({ body: completeLessonSchema }),
  asyncHandler(progressController.complete),
);

apiRouter.get(
  '/progress/me',
  authenticate,
  validate({ query: progressQuerySchema }),
  asyncHandler(progressController.listMine),
);

// --- dashboards ------------------------------------------------------------

apiRouter.get('/dashboard/learner', authenticate, asyncHandler(dashboardController.learner));

apiRouter.get(
  '/dashboard/admin',
  authenticate,
  requireRole('ADMIN'),
  asyncHandler(dashboardController.admin),
);

apiRouter.get(
  '/activity/me',
  authenticate,
  validate({ query: activityQuerySchema }),
  asyncHandler(dashboardController.myActivity),
);

// --- instructor applications (the applicant's own) -------------------------
// Every path is `/me`-shaped: no id in the URL selects which application to
// act on, so there is no number to change to reach someone else's.

apiRouter.post(
  '/instructor-applications',
  authenticate,
  csrfProtection,
  requirePermission('instructor:apply'),
  validate({ body: instructorApplicationInputSchema }),
  asyncHandler(applicationsController.apply),
);

/*
 * Reading your own status needs only a session, not `instructor:apply`: an
 * approved or suspended instructor has to be able to read this page too, and
 * they no longer hold that permission.
 */
apiRouter.get(
  '/instructor-applications/me',
  authenticate,
  asyncHandler(applicationsController.getMine),
);

apiRouter.patch(
  '/instructor-applications/me',
  authenticate,
  csrfProtection,
  validate({ body: instructorApplicationUpdateSchema }),
  asyncHandler(applicationsController.updateMine),
);

apiRouter.post(
  '/instructor-applications/me/withdraw',
  authenticate,
  csrfProtection,
  asyncHandler(applicationsController.withdrawMine),
);

// --- uploads ---------------------------------------------------------------
// Rate-limited separately from the rest of the API: asking for an upload
// target is cheap for a client and reserves a row and a key for us, so it
// is the one endpoint worth pacing per user rather than per route group.

apiRouter.post(
  '/uploads/presign',
  authenticate,
  csrfProtection,
  requirePermission('media:upload'),
  uploadLimiter,
  validate({ body: presignUploadSchema }),
  asyncHandler(uploadsController.presign),
);

apiRouter.post(
  '/uploads/:id/complete',
  authenticate,
  csrfProtection,
  requirePermission('media:upload'),
  validate({ params: idParamSchema, body: completeUploadSchema }),
  asyncHandler(uploadsController.complete),
);

apiRouter.delete(
  '/uploads/:id',
  authenticate,
  csrfProtection,
  requirePermission('media:upload'),
  validate({ params: idParamSchema }),
  asyncHandler(uploadsController.remove),
);

/*
 * Resumable uploads.
 *
 * `status` is what a resume begins with — which parts are already in
 * storage — and `parts` issues signed targets for the ones that are not,
 * in a batch so a 256-part file does not need 256 round trips to find
 * out where to put everything.
 */
apiRouter.get(
  '/uploads/:id/status',
  authenticate,
  requirePermission('media:upload'),
  validate({ params: idParamSchema }),
  asyncHandler(uploadsController.status),
);

apiRouter.post(
  '/uploads/:id/parts',
  authenticate,
  csrfProtection,
  requirePermission('media:upload'),
  validate({ params: idParamSchema, body: partTargetsRequestSchema }),
  asyncHandler(uploadsController.partTargets),
);

/** The local driver's part-receiving endpoint; unused on the S3 path. */
apiRouter.put(
  '/uploads/multipart/:uploadId/parts/:partNumber',
  authenticate,
  csrfProtection,
  requirePermission('media:upload'),
  asyncHandler(uploadsController.putPart),
);

/*
 * The local driver's receiving endpoint.  `express.json()` must not touch
 * it, so it is mounted with a raw body reader; with STORAGE_DRIVER=s3 the
 * browser never calls it and the handler answers 404.
 */
apiRouter.put(
  '/uploads/by-key/:key/bytes',
  authenticate,
  csrfProtection,
  requirePermission('media:upload'),
  asyncHandler(uploadsController.putBytes),
);

/** Public images: course thumbnails and instructor photos. */
apiRouter.get(/^\/media\/(.+)$/, asyncHandler(uploadsController.serveMedia));

/** Lesson video, behind the lesson's own access check, with Range support. */
apiRouter.get(
  '/lessons/:id/video',
  optionalAuthenticate,
  asyncHandler(uploadsController.streamLessonVideo),
);

// --- notifications ---------------------------------------------------------

apiRouter.get(
  '/notifications',
  authenticate,
  validate({ query: notificationQuerySchema }),
  asyncHandler(notificationsController.list),
);

apiRouter.post(
  '/notifications/read-all',
  authenticate,
  csrfProtection,
  asyncHandler(notificationsController.markAllRead),
);

apiRouter.post(
  '/notifications/:id/read',
  authenticate,
  csrfProtection,
  validate({ params: idParamSchema }),
  asyncHandler(notificationsController.markRead),
);

// --- admin -----------------------------------------------------------------
// One guard chain for the whole namespace: authenticated, CSRF-checked on
// mutations, and ADMIN-only.  A learner hitting any of these gets a 403.

const admin = Router();
admin.use(authenticate, csrfProtection, requireRole('ADMIN'));

admin.get('/courses', validate({ query: adminCourseQuerySchema }), asyncHandler(coursesController.adminList));
admin.post('/courses', validate({ body: courseInputSchema }), asyncHandler(coursesController.create));
admin.get('/courses/:id', validate({ params: idParamSchema }), asyncHandler(coursesController.adminDetail));
admin.patch('/courses/:id', validate({ params: idParamSchema, body: courseUpdateSchema }), asyncHandler(coursesController.update));
admin.delete('/courses/:id', validate({ params: idParamSchema }), asyncHandler(coursesController.remove));
admin.patch('/courses/:id/status', validate({ params: idParamSchema, body: courseStatusUpdateSchema }), asyncHandler(coursesController.setStatus));
admin.get('/courses/:id/publish-checklist', validate({ params: idParamSchema }), asyncHandler(coursesController.publishChecklist));

admin.post('/courses/:id/modules', validate({ params: idParamSchema, body: moduleInputSchema }), asyncHandler(lessonsController.createModule));
admin.patch('/modules/:id', validate({ params: idParamSchema, body: moduleUpdateSchema }), asyncHandler(lessonsController.updateModule));
admin.delete('/modules/:id', validate({ params: idParamSchema }), asyncHandler(lessonsController.deleteModule));

admin.post('/modules/:id/lessons', validate({ params: idParamSchema, body: lessonInputSchema }), asyncHandler(lessonsController.createLesson));
admin.patch('/modules/:id/lessons/reorder', validate({ params: idParamSchema, body: reorderLessonsSchema }), asyncHandler(lessonsController.reorderLessons));
admin.patch('/lessons/:id', validate({ params: idParamSchema, body: lessonUpdateSchema }), asyncHandler(lessonsController.updateLesson));
admin.delete('/lessons/:id', validate({ params: idParamSchema }), asyncHandler(lessonsController.deleteLesson));

admin.get('/users', validate({ query: adminUserQuerySchema }), asyncHandler(adminController.listUsers));
admin.get('/users/:id', validate({ params: idParamSchema }), asyncHandler(adminController.getLearner));
admin.get('/users/:id/progress', validate({ params: idParamSchema }), asyncHandler(adminController.learnerProgress));
admin.patch('/users/:id', validate({ params: idParamSchema, body: adminUserUpdateSchema }), asyncHandler(adminController.setActive));
admin.get('/courses/:id/learners', validate({ params: idParamSchema, query: paginationQuerySchema }), asyncHandler(adminController.courseLearners));
admin.get('/activity', validate({ query: activityQuerySchema }), asyncHandler(adminController.activity));

// Instructor applications and instructor management.  Inside the admin
// router, so they inherit `requireRole('ADMIN')` — an instructor reaching
// any of these is refused before the handler runs.
admin.get('/instructor-applications', validate({ query: adminApplicationQuerySchema }), asyncHandler(applicationsController.list));
admin.get('/instructor-applications/:id', validate({ params: idParamSchema }), asyncHandler(applicationsController.detail));
admin.post('/instructor-applications/:id/approve', validate({ params: idParamSchema, body: approveApplicationSchema }), asyncHandler(applicationsController.approve));
admin.post('/instructor-applications/:id/reject', validate({ params: idParamSchema, body: rejectApplicationSchema }), asyncHandler(applicationsController.reject));
admin.post('/instructor-applications/:id/notes', validate({ params: idParamSchema, body: applicationNoteSchema }), asyncHandler(applicationsController.addNote));

admin.get('/instructors', validate({ query: adminInstructorQuerySchema }), asyncHandler(applicationsController.listInstructors));
admin.post('/instructors/:id/suspend', validate({ params: idParamSchema, body: suspendInstructorSchema }), asyncHandler(applicationsController.suspend));
admin.post('/instructors/:id/reinstate', validate({ params: idParamSchema, body: reinstateInstructorSchema }), asyncHandler(applicationsController.reinstate));

apiRouter.use('/admin', admin);

// --- instructor ------------------------------------------------------------
// Its own router, with per-route permission guards: unlike /admin, the
// teaching workspace is not one capability. Reading the workspace survives
// suspension; writing to it does not.

apiRouter.use('/instructor', instructorRouter);

// --- auth (own router: its own rate limits and CSRF exemptions) ------------

apiRouter.use('/auth', authRouter);
