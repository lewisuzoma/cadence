import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AdminApplicationQuery,
  AdminInstructorQuery,
  CourseInput,
  CourseLearnerQuery,
  CourseUpdateInput,
  InstructorActivityQuery,
  InstructorApplicationInput,
  InstructorApplicationUpdateInput,
  InstructorCourseQuery,
  InstructorProfileUpdateInput,
  LessonInput,
  LessonUpdateInput,
  ModuleInput,
} from '@cadence/shared';
import { qk } from '@/lib/query-keys';
import { adminApplicationsApi, applicationsApi, instructorApi } from './instructor.api';

/**
 * Instructor data hooks.
 *
 * Two invalidation rules run through all of this and are worth stating
 * once rather than rediscovering at each mutation:
 *
 *  1. **A course mutation invalidates the public catalog too.** Publishing
 *     changes what a learner sees; leaving `qk.courses.*` alone would show
 *     a stale catalog to the very person who just changed it.
 *  2. **Anything that can change a role or a status invalidates
 *     `qk.auth.me()`.** The navigation, the route guards and the workspace
 *     switcher all read `me`, so an approval that did not invalidate it
 *     would leave the user looking at a UI that no longer matches their
 *     permissions.
 */

/** Everything a course change can affect, invalidated together. */
function invalidateCourseWorld(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: qk.instructor.all });
  // The catalog, because publishing and archiving change what learners see.
  void queryClient.invalidateQueries({ queryKey: qk.courses.all });
  void queryClient.invalidateQueries({ queryKey: qk.admin.all });
}

// ===========================================================================
// The applicant's own status
// ===========================================================================

/**
 * The caller's application status.
 *
 * Read by the status page *and* by the navigation, which is why it is one
 * cached query rather than two requests: the "Become an Instructor" and
 * "Application pending" entries are the same fact as the page's headline.
 */
export const myApplicationQueryOptions = () =>
  queryOptions({
    queryKey: qk.applications.mine(),
    queryFn: applicationsApi.mine,
    // Signed-out visitors get a 401 here; that is an answer, not a failure.
    retry: false,
    staleTime: 30_000,
  });

export function useMyApplication(enabled = true) {
  return useQuery({ ...myApplicationQueryOptions(), enabled });
}

export function useApplyToTeach() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InstructorApplicationInput) => applicationsApi.apply(input),
    // The form renders field errors itself.
    meta: { silent: true },
    onSuccess: (data) => {
      queryClient.setQueryData(qk.applications.mine(), data);
      toast.success('Application submitted', {
        description: 'An admin usually decides within 3 business days.',
      });
    },
  });
}

export function useUpdateApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InstructorApplicationUpdateInput) => applicationsApi.update(input),
    meta: { silent: true },
    onSuccess: (data) => {
      queryClient.setQueryData(qk.applications.mine(), data);
      toast.success('Application updated');
    },
  });
}

export function useWithdrawApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: applicationsApi.withdraw,
    onSuccess: (data) => {
      queryClient.setQueryData(qk.applications.mine(), data);
      toast.success('Application withdrawn');
    },
  });
}

// ===========================================================================
// The teaching workspace
// ===========================================================================

export const instructorDashboardQueryOptions = () =>
  queryOptions({
    queryKey: qk.instructor.dashboard(),
    queryFn: instructorApi.dashboard,
  });

export function useInstructorDashboard() {
  return useQuery(instructorDashboardQueryOptions());
}

export function useInstructorCourses(filters: Partial<InstructorCourseQuery>) {
  return useQuery({
    queryKey: qk.instructor.courses(filters),
    queryFn: () => instructorApi.courses(filters),
    // Paging and tab switching keep the previous page visible rather than
    // flashing a skeleton over content that is about to come straight back.
    placeholderData: keepPreviousData,
  });
}

export function useInstructorActivity(filters: Partial<InstructorActivityQuery>) {
  return useQuery({
    queryKey: qk.instructor.activity(filters),
    queryFn: () => instructorApi.activity(filters),
    placeholderData: keepPreviousData,
  });
}

export function useInstructorCourse(id: string | undefined) {
  return useQuery({
    queryKey: qk.instructor.course(id ?? ''),
    queryFn: () => instructorApi.course(id!),
    enabled: Boolean(id),
  });
}

export function useCoursePreview(id: string | undefined) {
  return useQuery({
    queryKey: qk.instructor.preview(id ?? ''),
    queryFn: () => instructorApi.preview(id!),
    enabled: Boolean(id),
  });
}

export function usePublishChecklist(id: string | undefined) {
  return useQuery({
    queryKey: qk.instructor.checklist(id ?? ''),
    queryFn: () => instructorApi.checklist(id!),
    enabled: Boolean(id),
  });
}

export function useCreateCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CourseInput) => instructorApi.create(input),
    meta: { silent: true },
    onSuccess: () => invalidateCourseWorld(queryClient),
  });
}

export function useUpdateCourse(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CourseUpdateInput) => instructorApi.update(id, input),
    meta: { silent: true },
    onSuccess: () => {
      invalidateCourseWorld(queryClient);
      toast.success('Changes saved');
    },
  });
}

export function useDeleteCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => instructorApi.remove(id),
    // The 409 "archive instead" message is worth showing as a toast.
    onSuccess: () => {
      invalidateCourseWorld(queryClient);
      toast.success('Course deleted');
    },
  });
}

/**
 * Publish, unpublish and archive.
 *
 * One hook over three endpoints, because the cache consequences are
 * identical and the only difference is which verb and which message.
 */
export function useCourseStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'publish' | 'unpublish' | 'archive') =>
      action === 'publish'
        ? instructorApi.publish(id)
        : action === 'unpublish'
          ? instructorApi.unpublish(id)
          : instructorApi.archive(id),
    // A failed publish carries the checklist; the page renders it in place.
    meta: { silent: true },
    onSuccess: (_data, action) => {
      invalidateCourseWorld(queryClient);
      toast.success(
        action === 'publish'
          ? 'Course published'
          : action === 'unpublish'
            ? 'Course moved back to drafts'
            : 'Course archived',
      );
    },
  });
}

// --- modules and lessons ---------------------------------------------------

export function useCreateModule(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ModuleInput) => instructorApi.createModule(courseId, input),
    onSuccess: () => invalidateCourseWorld(queryClient),
  });
}

export function useUpdateModule(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { moduleId: string; title: string }) =>
      instructorApi.updateModule(params.moduleId, { title: params.title }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.instructor.course(courseId) });
      void queryClient.invalidateQueries({ queryKey: qk.instructor.all });
    },
  });
}

export function useDeleteModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) => instructorApi.deleteModule(moduleId),
    // Not silent: the 409 for a module whose lessons have been watched is
    // the whole answer, and the page has nowhere better to show it.
    onSuccess: () => {
      invalidateCourseWorld(queryClient);
      toast.success('Module deleted');
    },
  });
}

export function useCreateLesson(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { moduleId: string; input: LessonInput }) =>
      instructorApi.createLesson(params.moduleId, params.input),
    meta: { silent: true },
    onSuccess: () => {
      invalidateCourseWorld(queryClient);
      void queryClient.invalidateQueries({ queryKey: qk.instructor.checklist(courseId) });
    },
  });
}

export function useUpdateLesson(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { lessonId: string; input: LessonUpdateInput }) =>
      instructorApi.updateLesson(params.lessonId, params.input),
    meta: { silent: true },
    onSuccess: () => {
      invalidateCourseWorld(queryClient);
      void queryClient.invalidateQueries({ queryKey: qk.instructor.checklist(courseId) });
    },
  });
}

export function useDeleteLesson(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => instructorApi.deleteLesson(lessonId),
    onSuccess: () => {
      invalidateCourseWorld(queryClient);
      void queryClient.invalidateQueries({ queryKey: qk.instructor.checklist(courseId) });
      toast.success('Lesson deleted');
    },
  });
}

/**
 * Reordering, with an optimistic update.
 *
 * Drag-and-drop that waits for a round trip before the item moves feels
 * broken, so the new order is written into the cache immediately and
 * rolled back if the server disagrees.
 */
export function useReorderLessons(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { moduleId: string; lessonIds: string[] }) =>
      instructorApi.reorderLessons(params.moduleId, params.lessonIds),
    meta: { silent: true },
    onError: () => {
      // Put the server's order back; the component's local state follows
      // the refetched course.
      void queryClient.invalidateQueries({ queryKey: qk.instructor.course(courseId) });
      toast.error('The new order could not be saved. Showing the saved order again.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.instructor.course(courseId) });
      void queryClient.invalidateQueries({ queryKey: qk.courses.all });
    },
  });
}

// --- analytics -------------------------------------------------------------

export function useCourseAnalytics(courseId: string | undefined) {
  return useQuery({
    queryKey: qk.instructor.analytics(courseId ?? ''),
    queryFn: () => instructorApi.analytics(courseId!),
    enabled: Boolean(courseId),
  });
}

export function useCourseLearners(
  courseId: string | undefined,
  filters: Partial<CourseLearnerQuery>,
) {
  return useQuery({
    queryKey: qk.instructor.learners(courseId ?? '', filters),
    queryFn: () => instructorApi.learners(courseId!, filters),
    enabled: Boolean(courseId),
    placeholderData: keepPreviousData,
  });
}

export function useLearnerProgress(courseId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: qk.instructor.learner(courseId ?? '', userId ?? ''),
    queryFn: () => instructorApi.learnerProgress(courseId!, userId!),
    enabled: Boolean(courseId && userId),
  });
}

// --- instructor profile ----------------------------------------------------

export function useInstructorProfile(enabled = true) {
  return useQuery({
    queryKey: qk.instructor.profile(),
    queryFn: instructorApi.profile,
    enabled,
    retry: false,
  });
}

export function useUpdateInstructorProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InstructorProfileUpdateInput) => instructorApi.updateProfile(input),
    meta: { silent: true },
    onSuccess: (data) => {
      queryClient.setQueryData(qk.instructor.profile(), data);
      // The display name and photo appear on course cards in the catalog.
      void queryClient.invalidateQueries({ queryKey: qk.courses.all });
      toast.success('Profile updated');
    },
  });
}

// ===========================================================================
// Admin review
// ===========================================================================

export function useAdminApplications(filters: Partial<AdminApplicationQuery>) {
  return useQuery({
    queryKey: qk.admin.applications(filters),
    queryFn: () => adminApplicationsApi.list(filters),
    placeholderData: keepPreviousData,
  });
}

export function useAdminApplication(id: string | undefined) {
  return useQuery({
    queryKey: qk.admin.application(id ?? ''),
    queryFn: () => adminApplicationsApi.detail(id!),
    enabled: Boolean(id),
  });
}

/**
 * Deciding an application.
 *
 * Invalidates `qk.auth.me()` as well as the admin lists: an admin can
 * approve their way through a queue, and if one of those people is looking
 * at the app in another tab, their next focus event picks up the change.
 */
export function useDecideApplication(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decision:
      | { action: 'approve'; reason?: string }
      | { action: 'reject'; reason: string }) =>
      decision.action === 'approve'
        ? adminApplicationsApi.approve(id, { reason: decision.reason })
        : adminApplicationsApi.reject(id, { reason: decision.reason }),
    meta: { silent: true },
    onSuccess: (data, decision) => {
      queryClient.setQueryData(qk.admin.application(id), data);
      void queryClient.invalidateQueries({ queryKey: qk.admin.all });
      void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
      void queryClient.invalidateQueries({ queryKey: qk.notifications.all });
      toast.success(
        decision.action === 'approve' ? 'Application approved' : 'Application rejected',
      );
    },
  });
}

export function useAddApplicationNote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => adminApplicationsApi.addNote(id, { note }),
    meta: { silent: true },
    onSuccess: (data) => {
      queryClient.setQueryData(qk.admin.application(id), data);
      toast.success('Note added');
    },
  });
}

export function useAdminInstructors(filters: Partial<AdminInstructorQuery>) {
  return useQuery({
    queryKey: qk.admin.instructors(filters),
    queryFn: () => adminApplicationsApi.listInstructors(filters),
    placeholderData: keepPreviousData,
  });
}

export function useInstructorStatusChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params:
      | { action: 'suspend'; userId: string; reason: string }
      | { action: 'reinstate'; userId: string; reason?: string }) =>
      params.action === 'suspend'
        ? adminApplicationsApi.suspend(params.userId, { reason: params.reason })
        : adminApplicationsApi.reinstate(params.userId, params.reason),
    meta: { silent: true },
    onSuccess: (_data, params) => {
      void queryClient.invalidateQueries({ queryKey: qk.admin.all });
      // A suspension hides the instructor's courses from the catalog.
      void queryClient.invalidateQueries({ queryKey: qk.courses.all });
      void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
      toast.success(
        params.action === 'suspend' ? 'Instructor suspended' : 'Instructor reinstated',
      );
    },
  });
}
