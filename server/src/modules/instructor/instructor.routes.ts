import { Router } from 'express';
import {
  courseInputSchema,
  courseLearnerParamsSchema,
  courseLearnerQuerySchema,
  courseStatusUpdateSchema,
  courseUpdateSchema,
  idParamSchema,
  instructorActivityQuerySchema,
  instructorCourseQuerySchema,
  instructorProfileUpdateSchema,
  lessonInputSchema,
  lessonUpdateSchema,
  moduleInputSchema,
  moduleUpdateSchema,
  reorderLessonsSchema,
} from '@cadence/shared';
import { authenticate, requirePermission } from '../../middlewares/authenticate.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { asyncHandler } from '../../middlewares/errorHandler.js';
import { validate } from '../../middlewares/validate.js';
import { analyticsController } from '../analytics/analytics.controller.js';
import { coursesController } from '../courses/courses.controller.js';
import { lessonsController } from '../lessons/lessons.controller.js';
import { instructorController } from './instructor.controller.js';

/**
 * The teaching workspace.
 *
 * Every route here is `authenticate` → `requirePermission` → the service's
 * own ownership check, which is the three-layer rule the prompt asks for.
 * The middleware decides *whether you may teach at all*; the service decides
 * *which courses are yours*. Neither is sufficient alone: the guard cannot
 * know about a particular course, and a service reached without a guard
 * would have no actor to scope by.
 *
 * These handlers are the same ones the `/admin` routes use. That is the
 * point — there is one course service and one lesson service, and the actor
 * passed into them is what makes an instructor see only their own work and
 * an admin see everything.
 */
export const instructorRouter = Router();

instructorRouter.use(authenticate, csrfProtection);

// --- dashboard, courses list, activity -------------------------------------

instructorRouter.get(
  '/dashboard',
  requirePermission('instructor:dashboard'),
  asyncHandler(instructorController.dashboard),
);

instructorRouter.get(
  '/courses',
  requirePermission('instructor:dashboard'),
  validate({ query: instructorCourseQuerySchema }),
  asyncHandler(instructorController.listCourses),
);

instructorRouter.get(
  '/activity',
  requirePermission('instructor:dashboard'),
  validate({ query: instructorActivityQuerySchema }),
  asyncHandler(instructorController.activity),
);

// --- a single course -------------------------------------------------------

instructorRouter.post(
  '/courses',
  requirePermission('course:create'),
  validate({ body: courseInputSchema }),
  asyncHandler(coursesController.create),
);

/*
 * Reading a course is gated on `instructor:dashboard` rather than
 * `course:manage-own`: a suspended instructor must still be able to open
 * their workspace and see what is there, otherwise the "your access is
 * suspended" page has nothing to show and the suspension looks like data
 * loss. Every *write* below requires `course:manage-own`, which suspension
 * does withdraw.
 */
instructorRouter.get(
  '/courses/:id',
  requirePermission('instructor:dashboard'),
  validate({ params: idParamSchema }),
  asyncHandler(coursesController.adminDetail),
);

instructorRouter.get(
  '/courses/:id/publish-checklist',
  requirePermission('instructor:dashboard'),
  validate({ params: idParamSchema }),
  asyncHandler(coursesController.publishChecklist),
);

/*
 * Preview sits on `instructor:dashboard`, like the other reads: a suspended
 * instructor can still look at their own course, they just cannot change it.
 */
instructorRouter.get(
  '/courses/:id/preview',
  requirePermission('instructor:dashboard'),
  validate({ params: idParamSchema }),
  asyncHandler(instructorController.preview),
);

// --- instructor profile ----------------------------------------------------
// Always the caller's own; there is no id in the path to point elsewhere.

instructorRouter.get(
  '/profile',
  requirePermission('instructor:dashboard'),
  asyncHandler(instructorController.getProfile),
);

instructorRouter.patch(
  '/profile',
  requirePermission('course:manage-own'),
  validate({ body: instructorProfileUpdateSchema }),
  asyncHandler(instructorController.updateProfile),
);

instructorRouter.patch(
  '/courses/:id',
  requirePermission('course:manage-own'),
  validate({ params: idParamSchema, body: courseUpdateSchema }),
  asyncHandler(coursesController.update),
);

instructorRouter.delete(
  '/courses/:id',
  requirePermission('course:manage-own'),
  validate({ params: idParamSchema }),
  asyncHandler(coursesController.remove),
);

/*
 * Publish, unpublish and archive are separate verbs rather than one
 * `PATCH /status`, because they are separate decisions with separate rules:
 * publishing runs a checklist, archiving is a soft retirement that keeps
 * enrolled learners, and the activity feed records them distinctly.
 */
instructorRouter.post(
  '/courses/:id/publish',
  requirePermission('course:manage-own'),
  validate({ params: idParamSchema }),
  asyncHandler(instructorController.publish),
);

instructorRouter.post(
  '/courses/:id/unpublish',
  requirePermission('course:manage-own'),
  validate({ params: idParamSchema }),
  asyncHandler(instructorController.unpublish),
);

instructorRouter.post(
  '/courses/:id/archive',
  requirePermission('course:manage-own'),
  validate({ params: idParamSchema }),
  asyncHandler(instructorController.archive),
);

instructorRouter.patch(
  '/courses/:id/status',
  requirePermission('course:manage-own'),
  validate({ params: idParamSchema, body: courseStatusUpdateSchema }),
  asyncHandler(coursesController.setStatus),
);

// --- modules and lessons ---------------------------------------------------

instructorRouter.post(
  '/courses/:id/modules',
  requirePermission('lesson:manage-own'),
  validate({ params: idParamSchema, body: moduleInputSchema }),
  asyncHandler(lessonsController.createModule),
);

instructorRouter.patch(
  '/modules/:id',
  requirePermission('lesson:manage-own'),
  validate({ params: idParamSchema, body: moduleUpdateSchema }),
  asyncHandler(lessonsController.updateModule),
);

instructorRouter.delete(
  '/modules/:id',
  requirePermission('lesson:manage-own'),
  validate({ params: idParamSchema }),
  asyncHandler(lessonsController.deleteModule),
);

instructorRouter.post(
  '/modules/:id/lessons',
  requirePermission('lesson:manage-own'),
  validate({ params: idParamSchema, body: lessonInputSchema }),
  asyncHandler(lessonsController.createLesson),
);

instructorRouter.patch(
  '/modules/:id/lessons/reorder',
  requirePermission('lesson:manage-own'),
  validate({ params: idParamSchema, body: reorderLessonsSchema }),
  asyncHandler(lessonsController.reorderLessons),
);

instructorRouter.patch(
  '/lessons/:id',
  requirePermission('lesson:manage-own'),
  validate({ params: idParamSchema, body: lessonUpdateSchema }),
  asyncHandler(lessonsController.updateLesson),
);

instructorRouter.delete(
  '/lessons/:id',
  requirePermission('lesson:manage-own'),
  validate({ params: idParamSchema }),
  asyncHandler(lessonsController.deleteLesson),
);

// --- analytics and learner monitoring --------------------------------------
//
// Reads, so `instructor:dashboard` rather than `course:manage-own`: a
// suspended instructor can still see how their published courses are doing,
// they simply cannot change anything.

instructorRouter.get(
  '/courses/:id/analytics',
  requirePermission('analytics:own-courses'),
  validate({ params: idParamSchema }),
  asyncHandler(analyticsController.course),
);

instructorRouter.get(
  '/courses/:id/learners',
  requirePermission('analytics:own-courses'),
  validate({ params: idParamSchema, query: courseLearnerQuerySchema }),
  asyncHandler(analyticsController.learners),
);

instructorRouter.get(
  '/courses/:id/learners/:userId/progress',
  requirePermission('analytics:own-courses'),
  // Both ids, because `validate` replaces req.params with what it parsed.
  validate({ params: courseLearnerParamsSchema }),
  asyncHandler(analyticsController.learnerProgress),
);
