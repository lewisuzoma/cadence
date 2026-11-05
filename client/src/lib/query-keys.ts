import type {
  AdminCourseQuery,
  AdminUserQuery,
  CourseQuery,
  EnrollmentQuery,
} from '@cadence/shared';

/**
 * Every cache key in the app, in one factory.
 *
 * Inline array keys are banned: they drift, they are impossible to invalidate
 * by prefix with confidence, and a typo silently creates a second cache entry.
 * With this factory, `queryClient.invalidateQueries({ queryKey: qk.courses.all })`
 * provably covers every course query.
 */
export const qk = {
  auth: {
    all: ['auth'] as const,
    me: () => [...qk.auth.all, 'me'] as const,
  },
  courses: {
    all: ['courses'] as const,
    list: (filters: Partial<CourseQuery>) => [...qk.courses.all, 'list', filters] as const,
    detail: (idOrSlug: string) => [...qk.courses.all, 'detail', idOrSlug] as const,
    categories: () => [...qk.courses.all, 'categories'] as const,
    lessons: (courseId: string) => [...qk.courses.all, 'lessons', courseId] as const,
  },
  lessons: {
    all: ['lessons'] as const,
    detail: (id: string) => [...qk.lessons.all, 'detail', id] as const,
  },
  progress: {
    all: ['progress'] as const,
    lesson: (lessonId: string) => [...qk.progress.all, 'lesson', lessonId] as const,
    mine: () => [...qk.progress.all, 'mine'] as const,
  },
  enrollments: {
    all: ['enrollments'] as const,
    me: (filters?: Partial<EnrollmentQuery>) => [...qk.enrollments.all, 'me', filters ?? {}] as const,
    forCourse: (courseId: string) => [...qk.enrollments.all, 'course', courseId] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    learner: () => [...qk.dashboard.all, 'learner'] as const,
    admin: () => [...qk.dashboard.all, 'admin'] as const,
  },
  activity: {
    all: ['activity'] as const,
    mine: (page: number) => [...qk.activity.all, 'mine', page] as const,
    platform: (page: number) => [...qk.activity.all, 'platform', page] as const,
  },
  admin: {
    all: ['admin'] as const,
    courses: (filters: Partial<AdminCourseQuery>) => [...qk.admin.all, 'courses', filters] as const,
    course: (id: string) => [...qk.admin.all, 'course', id] as const,
    users: (filters: Partial<AdminUserQuery>) => [...qk.admin.all, 'users', filters] as const,
    user: (id: string) => [...qk.admin.all, 'user', id] as const,
    courseLearners: (courseId: string, page: number) =>
      [...qk.admin.all, 'course-learners', courseId, page] as const,
  },
} as const;
