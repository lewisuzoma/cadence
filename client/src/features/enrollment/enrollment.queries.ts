import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CourseDetail,
  Enrollment,
  EnrollmentQuery,
  EnrollmentWithCourse,
} from '@cadence/shared';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

export const enrollmentApi = {
  enroll: (courseId: string) => apiClient.post<Enrollment>(`/courses/${courseId}/enroll`),
  leave: (courseId: string) => apiClient.delete<Enrollment>(`/courses/${courseId}/enroll`),
  forCourse: (courseId: string) =>
    apiClient.get<Enrollment>(`/courses/${courseId}/enrollment`),
  listMine: (query: Partial<EnrollmentQuery>) =>
    apiClient.getPaginated<EnrollmentWithCourse[]>('/enrollments/me', { query }),
};

export function useMyEnrollments(query: Partial<EnrollmentQuery> = {}) {
  return useQuery({
    queryKey: qk.enrollments.me(query),
    queryFn: () => enrollmentApi.listMine(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Enroll, with an optimistic update.
 *
 * The button flips to "Continue" immediately, because enrollment is
 * idempotent server-side and practically never fails. `onError` rolls the
 * cache back from the snapshot, and `onSettled` refetches so the authoritative
 * numbers (progress, lesson count) replace the optimistic guess.
 */
export function useEnroll(slugForCache?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (courseId: string) => enrollmentApi.enroll(courseId),

    onMutate: async (courseId: string) => {
      const detailKey = qk.courses.detail(slugForCache ?? courseId);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<CourseDetail>(detailKey);

      if (previous) {
        queryClient.setQueryData<CourseDetail>(detailKey, {
          ...previous,
          enrollment: {
            isEnrolled: true,
            status: 'ACTIVE',
            progressPercentage: 0,
            completedLessons: 0,
            lastLessonId: null,
            enrolledAt: new Date().toISOString(),
            completedAt: null,
          },
        });
      }

      return { detailKey, previous };
    },

    onError: (_error, _courseId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.detailKey, context.previous);
      }
    },

    onSuccess: () => {
      toast.success('You are enrolled', { description: 'Your progress will be saved as you watch.' });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.courses.all });
      void queryClient.invalidateQueries({ queryKey: qk.enrollments.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
    },
  });
}

/** Leaving a course keeps the learner's progress, so it can be undone. */
export function useLeaveCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => enrollmentApi.leave(courseId),
    onSuccess: () => {
      toast.success('You have left this course', {
        description: 'Your progress is kept if you come back.',
      });
      void queryClient.invalidateQueries({ queryKey: qk.courses.all });
      void queryClient.invalidateQueries({ queryKey: qk.enrollments.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
    },
  });
}
