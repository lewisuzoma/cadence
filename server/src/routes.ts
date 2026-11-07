import { Router } from 'express';
import {
  activityQuerySchema,
  adminCourseQuerySchema,
  adminUserQuerySchema,
  adminUserUpdateSchema,
  completeLessonSchema,
  courseInputSchema,
  courseQuerySchema,
  courseStatusUpdateSchema,
  courseUpdateSchema,
  enrollmentQuerySchema,
  idParamSchema,
  lessonInputSchema,
  lessonUpdateSchema,
  moduleInputSchema,
  moduleUpdateSchema,
  paginationQuerySchema,
  progressQuerySchema,
  reorderLessonsSchema,
  saveProgressSchema,
} from '@cadence/shared';
import { authenticate, optionalAuthenticate, requireRole } from './middlewares/authenticate.js';
import { csrfProtection } from './middlewares/csrf.js';
import { asyncHandler } from './middlewares/errorHandler.js';
import { validate } from './middlewares/validate.js';
import { adminController } from './modules/admin/admin.controller.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { coursesController } from './modules/courses/courses.controller.js';
import { dashboardController } from './modules/dashboard/dashboard.controller.js';
import { enrollmentController } from './modules/enrollment/enrollment.controller.js';
import { instructorRouter } from './modules/instructor/instructor.routes.js';
import { lessonsController } from './modules/lessons/lessons.controller.js';
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

apiRouter.use('/admin', admin);

// --- instructor ------------------------------------------------------------
// Its own router, with per-route permission guards: unlike /admin, the
// teaching workspace is not one capability. Reading the workspace survives
// suspension; writing to it does not.

apiRouter.use('/instructor', instructorRouter);

// --- auth (own router: its own rate limits and CSRF exemptions) ------------

apiRouter.use('/auth', authRouter);
