import type {
  AdminCourseQuery,
  CourseDetail,
  CourseInput,
  CourseQuery,
  CourseStatus,
  CourseSummary,
  CourseUpdateInput,
  LessonDetail,
  LessonInput,
  LessonSummary,
  LessonUpdateInput,
  ModuleInput,
  ModuleUpdateInput,
} from '@cadence/shared';
import { apiClient, type Paginated } from '@/lib/api-client';

/** Catalog, course detail, lessons, and the admin content endpoints. */
export const coursesApi = {
  list: (query: Partial<CourseQuery>) =>
    apiClient.getPaginated<CourseSummary[]>('/courses', { query }),

  categories: () => apiClient.get<string[]>('/courses/categories'),

  detail: (idOrSlug: string) => apiClient.get<CourseDetail>(`/courses/${idOrSlug}`),

  lessonsForCourse: (courseId: string) =>
    apiClient.get<LessonSummary[]>(`/courses/${courseId}/lessons`),

  lesson: (lessonId: string) => apiClient.get<LessonDetail>(`/lessons/${lessonId}`),

  // --- admin -------------------------------------------------------------

  adminList: (query: Partial<AdminCourseQuery>): Promise<Paginated<CourseSummary[]>> =>
    apiClient.getPaginated<CourseSummary[]>('/admin/courses', { query }),

  adminDetail: (id: string) => apiClient.get<CourseDetail>(`/admin/courses/${id}`),

  create: (input: CourseInput) => apiClient.post<CourseSummary>('/admin/courses', input),

  update: (id: string, input: CourseUpdateInput) =>
    apiClient.patch<CourseSummary>(`/admin/courses/${id}`, input),

  setStatus: (id: string, status: CourseStatus) =>
    apiClient.patch<CourseSummary>(`/admin/courses/${id}/status`, { status }),

  remove: (id: string) => apiClient.delete(`/admin/courses/${id}`),

  createModule: (courseId: string, input: ModuleInput) =>
    apiClient.post<{ id: string; title: string; order: number }>(
      `/admin/courses/${courseId}/modules`,
      input,
    ),

  updateModule: (moduleId: string, input: ModuleUpdateInput) =>
    apiClient.patch<{ id: string; title: string; order: number }>(
      `/admin/modules/${moduleId}`,
      input,
    ),

  deleteModule: (moduleId: string) => apiClient.delete(`/admin/modules/${moduleId}`),

  createLesson: (moduleId: string, input: LessonInput) =>
    apiClient.post<LessonSummary>(`/admin/modules/${moduleId}/lessons`, input),

  updateLesson: (lessonId: string, input: LessonUpdateInput) =>
    apiClient.patch<LessonSummary>(`/admin/lessons/${lessonId}`, input),

  deleteLesson: (lessonId: string) => apiClient.delete(`/admin/lessons/${lessonId}`),

  reorderLessons: (moduleId: string, lessonIds: string[]) =>
    apiClient.patch<LessonSummary[]>(`/admin/modules/${moduleId}/lessons/reorder`, {
      lessonIds,
    }),
};
