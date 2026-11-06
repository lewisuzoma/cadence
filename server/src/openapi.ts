import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  activityItemSchema,
  adminCourseQuerySchema,
  adminLearnerDetailSchema,
  adminUserQuerySchema,
  adminUserRowSchema,
  adminUserUpdateSchema,
  changePasswordSchema,
  completeLessonSchema,
  courseDetailSchema,
  courseInputSchema,
  courseQuerySchema,
  courseStatusUpdateSchema,
  courseSummarySchema,
  courseUpdateSchema,
  enrollmentQuerySchema,
  enrollmentSchema,
  enrollmentWithCourseSchema,
  forgotPasswordSchema,
  learnerDashboardSchema,
  lessonDetailSchema,
  lessonInputSchema,
  lessonSummarySchema,
  loginSchema,
  moduleInputSchema,
  progressResultSchema,
  registerSchema,
  reorderLessonsSchema,
  resetPasswordSchema,
  saveProgressSchema,
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
