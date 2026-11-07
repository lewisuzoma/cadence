import type {
  AdminApplicationDetail,
  AdminApplicationListItem,
  AdminApplicationQuery,
  AdminInstructorListItem,
  AdminInstructorQuery,
  ApplicationNoteInput,
  ApproveApplicationInput,
  CourseAnalytics,
  CourseDetail,
  CourseInput,
  CourseLearnerQuery,
  CourseLearnerRow,
  CoursePreview,
  CourseSummary,
  CourseUpdateInput,
  InstructorActivityItem,
  InstructorActivityQuery,
  InstructorApplicationInput,
  InstructorApplicationUpdateInput,
  InstructorCourseCard,
  InstructorCourseQuery,
  InstructorDashboard,
  InstructorProfile,
  InstructorProfileUpdateInput,
  LearnerCourseProgress,
  LessonInput,
  LessonSummary,
  LessonUpdateInput,
  ModuleInput,
  ModuleUpdateInput,
  MyApplication,
  PublishChecklist,
  RejectApplicationInput,
  SuspendInstructorInput,
} from '@cadence/shared';
import { apiClient, type Paginated } from '@/lib/api-client';

/**
 * Every instructor-feature call, in one place.
 *
 * Request and response types come from `@cadence/shared`, so a change to a
 * server schema is a compile error here rather than a runtime surprise.
 */

export const applicationsApi = {
  mine: () => apiClient.get<MyApplication>('/instructor-applications/me'),

  apply: (input: InstructorApplicationInput) =>
    apiClient.post<MyApplication>('/instructor-applications', input),

  update: (input: InstructorApplicationUpdateInput) =>
    apiClient.patch<MyApplication>('/instructor-applications/me', input),

  withdraw: () => apiClient.post<MyApplication>('/instructor-applications/me/withdraw'),
};

export const adminApplicationsApi = {
  list: (query: Partial<AdminApplicationQuery>): Promise<Paginated<AdminApplicationListItem[]>> =>
    apiClient.getPaginated<AdminApplicationListItem[]>('/admin/instructor-applications', {
      query,
    }),

  detail: (id: string) =>
    apiClient.get<AdminApplicationDetail>(`/admin/instructor-applications/${id}`),

  approve: (id: string, input: ApproveApplicationInput) =>
    apiClient.post<AdminApplicationDetail>(
      `/admin/instructor-applications/${id}/approve`,
      input,
    ),

  reject: (id: string, input: RejectApplicationInput) =>
    apiClient.post<AdminApplicationDetail>(
      `/admin/instructor-applications/${id}/reject`,
      input,
    ),

  addNote: (id: string, input: ApplicationNoteInput) =>
    apiClient.post<AdminApplicationDetail>(
      `/admin/instructor-applications/${id}/notes`,
      input,
    ),

  listInstructors: (
    query: Partial<AdminInstructorQuery>,
  ): Promise<Paginated<AdminInstructorListItem[]>> =>
    apiClient.getPaginated<AdminInstructorListItem[]>('/admin/instructors', { query }),

  suspend: (userId: string, input: SuspendInstructorInput) =>
    apiClient.post<{ userId: string; status: string }>(
      `/admin/instructors/${userId}/suspend`,
      input,
    ),

  reinstate: (userId: string, reason?: string) =>
    apiClient.post<{ userId: string; status: string }>(
      `/admin/instructors/${userId}/reinstate`,
      reason ? { reason } : {},
    ),
};

export const instructorApi = {
  dashboard: () => apiClient.get<InstructorDashboard>('/instructor/dashboard'),

  courses: (query: Partial<InstructorCourseQuery>): Promise<Paginated<InstructorCourseCard[]>> =>
    apiClient.getPaginated<InstructorCourseCard[]>('/instructor/courses', { query }),

  activity: (
    query: Partial<InstructorActivityQuery>,
  ): Promise<Paginated<InstructorActivityItem[]>> =>
    apiClient.getPaginated<InstructorActivityItem[]>('/instructor/activity', { query }),

  course: (id: string) => apiClient.get<CourseDetail>(`/instructor/courses/${id}`),

  preview: (id: string) => apiClient.get<CoursePreview>(`/instructor/courses/${id}/preview`),

  checklist: (id: string) =>
    apiClient.get<PublishChecklist>(`/instructor/courses/${id}/publish-checklist`),

  create: (input: CourseInput) =>
    apiClient.post<CourseSummary>('/instructor/courses', input),

  update: (id: string, input: CourseUpdateInput) =>
    apiClient.patch<CourseSummary>(`/instructor/courses/${id}`, input),

  remove: (id: string) => apiClient.delete(`/instructor/courses/${id}`),

  publish: (id: string) =>
    apiClient.post<CourseSummary>(`/instructor/courses/${id}/publish`),

  unpublish: (id: string) =>
    apiClient.post<CourseSummary>(`/instructor/courses/${id}/unpublish`),

  archive: (id: string) =>
    apiClient.post<CourseSummary>(`/instructor/courses/${id}/archive`),

  // --- modules and lessons ---------------------------------------------

  createModule: (courseId: string, input: ModuleInput) =>
    apiClient.post<{ id: string; title: string; order: number }>(
      `/instructor/courses/${courseId}/modules`,
      input,
    ),

  updateModule: (moduleId: string, input: ModuleUpdateInput) =>
    apiClient.patch<{ id: string; title: string; order: number }>(
      `/instructor/modules/${moduleId}`,
      input,
    ),

  deleteModule: (moduleId: string) => apiClient.delete(`/instructor/modules/${moduleId}`),

  createLesson: (moduleId: string, input: LessonInput) =>
    apiClient.post<LessonSummary>(`/instructor/modules/${moduleId}/lessons`, input),

  updateLesson: (lessonId: string, input: LessonUpdateInput) =>
    apiClient.patch<LessonSummary>(`/instructor/lessons/${lessonId}`, input),

  deleteLesson: (lessonId: string) => apiClient.delete(`/instructor/lessons/${lessonId}`),

  reorderLessons: (moduleId: string, lessonIds: string[]) =>
    apiClient.patch<LessonSummary[]>(`/instructor/modules/${moduleId}/lessons/reorder`, {
      lessonIds,
    }),

  // --- analytics ---------------------------------------------------------

  analytics: (courseId: string) =>
    apiClient.get<CourseAnalytics>(`/instructor/courses/${courseId}/analytics`),

  learners: (
    courseId: string,
    query: Partial<CourseLearnerQuery>,
  ): Promise<Paginated<CourseLearnerRow[]>> =>
    apiClient.getPaginated<CourseLearnerRow[]>(
      `/instructor/courses/${courseId}/learners`,
      { query },
    ),

  learnerProgress: (courseId: string, userId: string) =>
    apiClient.get<LearnerCourseProgress>(
      `/instructor/courses/${courseId}/learners/${userId}/progress`,
    ),

  // --- profile -----------------------------------------------------------

  profile: () => apiClient.get<InstructorProfile>('/instructor/profile'),

  updateProfile: (input: InstructorProfileUpdateInput) =>
    apiClient.patch<InstructorProfile>('/instructor/profile', input),
};
