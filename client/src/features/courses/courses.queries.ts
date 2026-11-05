import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AdminCourseQuery,
  CourseInput,
  CourseQuery,
  CourseStatus,
  CourseUpdateInput,
  LessonInput,
  LessonUpdateInput,
  ModuleInput,
} from '@cadence/shared';
import { qk } from '@/lib/query-keys';
import { coursesApi } from './courses.api';

/**
 * Course queries and the invalidation map for every content mutation.
 *
 * Publishing a course changes the admin table AND the learner catalog, so
 * every admin mutation invalidates both namespaces. Getting this wrong is the
 * usual cause of "I published it but it is not showing up".
 */

export const coursesListQueryOptions = (query: Partial<CourseQuery>) =>
  queryOptions({
    queryKey: qk.courses.list(query),
    queryFn: () => coursesApi.list(query),
    // Keeps the previous page on screen while the next one loads, so
    // paginating does not flash an empty grid.
    placeholderData: keepPreviousData,
  });

export const courseDetailQueryOptions = (idOrSlug: string) =>
  queryOptions({
    queryKey: qk.courses.detail(idOrSlug),
    queryFn: () => coursesApi.detail(idOrSlug),
    enabled: Boolean(idOrSlug),
  });

export const lessonQueryOptions = (lessonId: string) =>
  queryOptions({
    queryKey: qk.lessons.detail(lessonId),
    queryFn: () => coursesApi.lesson(lessonId),
    enabled: Boolean(lessonId),
    // The player must not be yanked out from under someone on window focus.
    refetchOnWindowFocus: false,
  });

export function useCourses(query: Partial<CourseQuery>) {
  return useQuery(coursesListQueryOptions(query));
}

export function useCourse(idOrSlug: string) {
  return useQuery(courseDetailQueryOptions(idOrSlug));
}

export function useLesson(lessonId: string) {
  return useQuery(lessonQueryOptions(lessonId));
}

export function useCourseCategories() {
  return useQuery({
    queryKey: qk.courses.categories(),
    queryFn: coursesApi.categories,
    // The category list changes when an admin adds a course, not per visit.
    staleTime: 10 * 60_000,
  });
}

export function useCourseLessons(courseId: string) {
  return useQuery({
    queryKey: qk.courses.lessons(courseId),
    queryFn: () => coursesApi.lessonsForCourse(courseId),
    enabled: Boolean(courseId),
  });
}

/** Prefetch on CourseCard hover or focus, so opening a course feels instant. */
export function usePrefetchCourse() {
  const queryClient = useQueryClient();
  return (slug: string) => {
    void queryClient.prefetchQuery(courseDetailQueryOptions(slug));
  };
}

// --- admin -----------------------------------------------------------------

export function useAdminCourses(query: Partial<AdminCourseQuery>) {
  return useQuery({
    queryKey: qk.admin.courses(query),
    queryFn: () => coursesApi.adminList(query),
    placeholderData: keepPreviousData,
  });
}

export function useAdminCourse(id: string) {
  return useQuery({
    queryKey: qk.admin.course(id),
    queryFn: () => coursesApi.adminDetail(id),
    enabled: Boolean(id),
  });
}

/** Anything that changes course content invalidates these. */
function useContentInvalidation() {
  const queryClient = useQueryClient();
  return (courseId?: string) => {
    void queryClient.invalidateQueries({ queryKey: qk.admin.all });
    void queryClient.invalidateQueries({ queryKey: qk.courses.all });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
    if (courseId) {
      void queryClient.invalidateQueries({ queryKey: qk.admin.course(courseId) });
    }
  };
}

export function useCreateCourse() {
  const invalidate = useContentInvalidation();
  return useMutation({
    mutationFn: (input: CourseInput) => coursesApi.create(input),
    meta: { silent: true },
    onSuccess: (course) => {
      invalidate();
      toast.success('Course created', { description: `${course.title} is saved as a draft.` });
    },
  });
}

export function useUpdateCourse(id: string) {
  const invalidate = useContentInvalidation();
  return useMutation({
    mutationFn: (input: CourseUpdateInput) => coursesApi.update(id, input),
    meta: { silent: true },
    onSuccess: () => {
      invalidate(id);
      toast.success('Course saved');
    },
  });
}

export function useSetCourseStatus() {
  const invalidate = useContentInvalidation();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: CourseStatus }) =>
      coursesApi.setStatus(id, status),
    onSuccess: (course) => {
      invalidate(course.id);
      const message =
        course.status === 'PUBLISHED'
          ? 'Course published'
          : course.status === 'ARCHIVED'
            ? 'Course archived'
            : 'Course moved back to draft';
      toast.success(message);
    },
  });
}

export function useDeleteCourse() {
  const invalidate = useContentInvalidation();
  return useMutation({
    // Silent: the confirm dialog shows the 409 "archive instead" message in
    // place, which is more useful than a toast that vanishes.
    meta: { silent: true },
    mutationFn: (id: string) => coursesApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success('Course deleted');
    },
  });
}

export function useCreateModule(courseId: string) {
  const invalidate = useContentInvalidation();
  return useMutation({
    mutationFn: (input: ModuleInput) => coursesApi.createModule(courseId, input),
    onSuccess: () => invalidate(courseId),
  });
}

export function useDeleteModule(courseId: string) {
  const invalidate = useContentInvalidation();
  return useMutation({
    meta: { silent: true },
    mutationFn: (moduleId: string) => coursesApi.deleteModule(moduleId),
    onSuccess: () => invalidate(courseId),
  });
}

export function useCreateLesson(courseId: string) {
  const invalidate = useContentInvalidation();
  return useMutation({
    mutationFn: ({ moduleId, input }: { moduleId: string; input: LessonInput }) =>
      coursesApi.createLesson(moduleId, input),
    meta: { silent: true },
    onSuccess: () => {
      invalidate(courseId);
      toast.success('Lesson added');
    },
  });
}

export function useUpdateLesson(courseId: string) {
  const invalidate = useContentInvalidation();
  return useMutation({
    mutationFn: ({ lessonId, input }: { lessonId: string; input: LessonUpdateInput }) =>
      coursesApi.updateLesson(lessonId, input),
    meta: { silent: true },
    onSuccess: () => invalidate(courseId),
  });
}

export function useDeleteLesson(courseId: string) {
  const invalidate = useContentInvalidation();
  return useMutation({
    meta: { silent: true },
    mutationFn: (lessonId: string) => coursesApi.deleteLesson(lessonId),
    onSuccess: () => {
      invalidate(courseId);
      toast.success('Lesson removed');
    },
  });
}

export function useReorderLessons(courseId: string) {
  const invalidate = useContentInvalidation();
  return useMutation({
    mutationFn: ({ moduleId, lessonIds }: { moduleId: string; lessonIds: string[] }) =>
      coursesApi.reorderLessons(moduleId, lessonIds),
    onSuccess: () => invalidate(courseId),
  });
}
