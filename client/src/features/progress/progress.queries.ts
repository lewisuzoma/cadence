import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LessonProgressState,
  ProgressEvent,
  ProgressResult,
} from '@cadence/shared';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

export type LessonProgressResponse = {
  lessonId: string;
  courseId: string;
  durationSeconds: number;
  progress: LessonProgressState | null;
};

export const progressApi = {
  forLesson: (lessonId: string) =>
    apiClient.get<LessonProgressResponse>(`/lessons/${lessonId}/progress`),

  save: (lessonId: string, positionSeconds: number, event: ProgressEvent) =>
    apiClient.put<ProgressResult>(`/lessons/${lessonId}/progress`, {
      positionSeconds,
      event,
    }),

  complete: (lessonId: string, positionSeconds: number) =>
    apiClient.post<ProgressResult>(`/lessons/${lessonId}/complete`, { positionSeconds }),

  /** The unload flush: keepalive, no response handling, errors swallowed. */
  flush: (lessonId: string, positionSeconds: number, event: ProgressEvent) =>
    apiClient.flush(`/lessons/${lessonId}/progress`, { positionSeconds, event }),
};

export function useLessonProgress(lessonId: string, enabled = true) {
  return useQuery({
    queryKey: qk.progress.lesson(lessonId),
    queryFn: () => progressApi.forLesson(lessonId),
    enabled: Boolean(lessonId) && enabled,
    // The player owns this value; refetching on focus would fight the
    // in-flight position the tracker is maintaining.
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Writes a progress result into the cache in place.
 *
 * Shared by the tracker and the complete mutation so both keep the player's
 * view and the course roll-up consistent without a refetch round trip.
 */
export function useApplyProgressResult() {
  const queryClient = useQueryClient();

  return (result: ProgressResult) => {
    queryClient.setQueryData<LessonProgressResponse>(
      qk.progress.lesson(result.lessonId),
      (previous) =>
        previous
          ? { ...previous, progress: result.progress }
          : {
              lessonId: result.lessonId,
              courseId: result.courseId,
              durationSeconds: 0,
              progress: result.progress,
            },
    );
  };
}

/**
 * Explicit completion (the video's `ended` event, or the Mark complete
 * button). Invalidates everything that shows a percentage, because finishing
 * a lesson can also finish the course.
 */
export function useCompleteLesson() {
  const queryClient = useQueryClient();
  const applyResult = useApplyProgressResult();

  return useMutation({
    mutationFn: ({ lessonId, positionSeconds }: { lessonId: string; positionSeconds: number }) =>
      progressApi.complete(lessonId, positionSeconds),

    onSuccess: (result) => {
      applyResult(result);
      void queryClient.invalidateQueries({ queryKey: qk.courses.all });
      void queryClient.invalidateQueries({ queryKey: qk.lessons.all });
      void queryClient.invalidateQueries({ queryKey: qk.enrollments.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
      void queryClient.invalidateQueries({ queryKey: qk.activity.all });
    },
  });
}

export function useMyProgress(page = 1) {
  return useQuery({
    queryKey: [...qk.progress.mine(), page],
    queryFn: () => apiClient.getPaginated('/progress/me', { query: { page } }),
  });
}
