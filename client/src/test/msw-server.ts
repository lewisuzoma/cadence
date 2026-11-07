import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import type {
  CourseDetail,
  CourseSummary,
  LearnerDashboard,
  LessonDetail,
  User,
} from '@cadence/shared';

/**
 * The default MSW handlers: a small, coherent world the tests can override
 * per case with `server.use(...)`.
 *
 * Responses use the real API envelope, because the api-client unwraps it and
 * a test that skipped the envelope would not be testing the client at all.
 */

const API = '/api/v1';

export const ok = <T>(data: T, message = 'ok', meta?: unknown) =>
  HttpResponse.json(meta ? { success: true, message, data, meta } : { success: true, message, data });

export const fail = (status: number, code: string, message: string, errors?: unknown) =>
  HttpResponse.json({ success: false, message, code, ...(errors ? { errors } : {}) }, { status });

export const learnerUser: User = {
  id: '11111111-1111-1111-1111-111111111111',
  firstName: 'Ada',
  lastName: 'Okafor',
  email: 'ada@cadence.dev',
  role: 'LEARNER',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  instructorStatus: null,
};

export const adminUser: User = {
  ...learnerUser,
  id: '22222222-2222-2222-2222-222222222222',
  firstName: 'Tunde',
  lastName: 'Bakare',
  email: 'admin@cadence.dev',
  role: 'ADMIN',
};

export const courseSummary: CourseSummary = {
  id: '33333333-3333-3333-3333-333333333333',
  slug: 'typescript-for-production-apis',
  title: 'TypeScript for Production APIs',
  description: 'Build a typed Node.js API end to end, with the tests that keep it honest.',
  shortDescription: 'A typed Node.js API, end to end.',
  instructor: null,
  category: 'Engineering',
  thumbnailUrl: '/thumbnails/typescript-for-production-apis.svg',
  difficulty: 'INTERMEDIATE',
  status: 'PUBLISHED',
  lessonCount: 12,
  estimatedDuration: 15600,
  publishedAt: '2026-02-01T00:00:00.000Z',
  createdAt: '2026-01-15T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  enrollment: null,
};

export const enrolledCourse: CourseSummary = {
  ...courseSummary,
  enrollment: {
    isEnrolled: true,
    status: 'ACTIVE',
    progressPercentage: 58,
    completedLessons: 7,
    lastLessonId: '44444444-4444-4444-4444-444444444444',
    enrolledAt: '2026-02-10T00:00:00.000Z',
    completedAt: null,
  },
};

export const courseDetail: CourseDetail = {
  ...courseSummary,
  learningObjectives: [],
  prerequisites: [],
  targetAudience: '',
  createdBy: { id: adminUser.id, firstName: 'Tunde', lastName: 'Bakare' },
  modules: [
    {
      id: '55555555-5555-5555-5555-555555555555',
      title: 'Module 1 · Foundations',
      order: 1,
      lessons: [
        {
          id: '44444444-4444-4444-4444-444444444444',
          moduleId: '55555555-5555-5555-5555-555555555555',
          courseId: courseSummary.id,
          title: 'Project setup and tsconfig',
          description: 'Strict compiler options.',
          durationSeconds: 725,
          order: 1,
          isPreview: true,
          status: 'IN_PROGRESS',
          progress: {
            lastPositionSeconds: 522,
            maxWatchedSeconds: 522,
            completionPercentage: 61,
            isCompleted: false,
            completedAt: null,
            updatedAt: '2026-02-12T00:00:00.000Z',
          },
        },
        {
          id: '66666666-6666-6666-6666-666666666666',
          moduleId: '55555555-5555-5555-5555-555555555555',
          courseId: courseSummary.id,
          title: 'Types that model your domain',
          description: 'Make illegal states unrepresentable.',
          durationSeconds: 1000,
          order: 2,
          isPreview: false,
          status: 'NOT_STARTED',
          progress: null,
        },
      ],
    },
  ],
};

export const lessonDetail: LessonDetail = {
  ...courseDetail.modules[0]!.lessons[0]!,
  videoUrl: 'https://example.test/lesson.mp4',
  captionsUrl: null,
  module: { id: '55555555-5555-5555-5555-555555555555', title: 'Module 1', order: 1 },
  course: { id: courseSummary.id, slug: courseSummary.slug, title: courseSummary.title },
  previousLessonId: null,
  nextLessonId: '66666666-6666-6666-6666-666666666666',
  isTracked: true,
};

export const learnerDashboard: LearnerDashboard = {
  stats: {
    enrolledCourses: 3,
    inProgressCourses: 2,
    completedCourses: 1,
    completedLessons: 18,
    totalLessons: 38,
    overallProgressPercentage: 47,
    watchedSeconds: 22320,
    streakDays: 4,
    lessonsThisWeek: 3,
  },
  continueLearning: {
    courseId: courseSummary.id,
    courseSlug: courseSummary.slug,
    courseTitle: courseSummary.title,
    thumbnailUrl: courseSummary.thumbnailUrl,
    lessonId: '44444444-4444-4444-4444-444444444444',
    lessonTitle: 'Validating input with Zod',
    moduleTitle: 'Module 2',
    lastPositionSeconds: 522,
    durationSeconds: 860,
    courseProgressPercentage: 58,
  },
  courses: [],
  recentActivity: [],
};

/** The signed-in learner is the default; tests override for other cases. */
export const handlers = [
  http.get(`${API}/auth/me`, () => ok({ user: learnerUser }, 'Current user')),

  /**
   * Deliberately does NOT read the request body.
   *
   * Reading it (`await request.json()`) makes MSW clone the Request, and in
   * jsdom that surfaces undici's "Expected signal to be an instance of
   * AbortSignal" cross-realm error: jsdom's AbortSignal is a different class
   * from the one Node's fetch expects. The promise then never settles and the
   * component looks frozen. Tests that need a specific outcome override this
   * handler instead, which keeps every handler body-free.
   */
  http.post(`${API}/auth/login`, () => ok({ user: learnerUser }, 'Signed in')),

  http.post(`${API}/auth/register`, () => ok({ user: learnerUser }, 'Account created')),
  http.post(`${API}/auth/logout`, () => ok({ success: true }, 'Signed out')),
  http.post(`${API}/auth/forgot-password`, () =>
    ok({ success: true }, 'If an account exists for that email, a reset link is on its way'),
  ),
  http.post(`${API}/auth/reset-password`, () =>
    ok({ success: true }, 'Password updated. Sign in with your new password.'),
  ),
  http.post(`${API}/auth/refresh`, () => fail(401, 'UNAUTHENTICATED', 'Session expired')),

  http.get(`${API}/courses`, () =>
    ok([courseSummary], 'Courses retrieved', {
      page: 1,
      pageSize: 12,
      total: 1,
      totalPages: 1,
    }),
  ),
  http.get(`${API}/courses/categories`, () => ok(['Engineering', 'Design'])),
  http.get(`${API}/courses/:idOrSlug`, () => ok(courseDetail, 'Course retrieved')),
  http.get(`${API}/courses/:courseId/lessons`, () =>
    ok(courseDetail.modules.flatMap((module) => module.lessons)),
  ),
  http.post(`${API}/courses/:courseId/enroll`, () =>
    ok(
      {
        id: '77777777-7777-7777-7777-777777777777',
        userId: learnerUser.id,
        courseId: courseSummary.id,
        status: 'ACTIVE',
        enrolledAt: '2026-02-10T00:00:00.000Z',
        lastAccessedAt: null,
        lastLessonId: null,
        completedAt: null,
        progressPercentage: 0,
        completedLessons: 0,
        totalLessons: 12,
      },
      'Enrolled',
    ),
  ),

  http.get(`${API}/lessons/:id`, () => ok(lessonDetail, 'Lesson retrieved')),
  http.get(`${API}/lessons/:id/progress`, () =>
    ok(
      {
        lessonId: lessonDetail.id,
        courseId: courseSummary.id,
        durationSeconds: lessonDetail.durationSeconds,
        progress: lessonDetail.progress,
      },
      'Progress retrieved',
    ),
  ),

  http.get(`${API}/dashboard/learner`, () => ok(learnerDashboard, 'Dashboard retrieved')),
  http.get(`${API}/enrollments/me`, () =>
    ok([], 'Enrollments retrieved', { page: 1, pageSize: 12, total: 0, totalPages: 1 }),
  ),
];

export const server = setupServer(...handlers);
