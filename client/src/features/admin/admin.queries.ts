import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AdminCourseLearner,
  AdminLearnerDetail,
  AdminUserQuery,
  AdminUserRow,
} from '@cadence/shared';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

export const adminApi = {
  users: (query: Partial<AdminUserQuery>) =>
    apiClient.getPaginated<AdminUserRow[]>('/admin/users', { query }),
  user: (id: string) => apiClient.get<AdminLearnerDetail>(`/admin/users/${id}`),
  setActive: (id: string, isActive: boolean) =>
    apiClient.patch<AdminUserRow>(`/admin/users/${id}`, { isActive }),
  courseLearners: (courseId: string, page: number) =>
    apiClient.getPaginated<AdminCourseLearner[]>(`/admin/courses/${courseId}/learners`, {
      query: { page },
    }),
};

export function useAdminUsers(query: Partial<AdminUserQuery>) {
  return useQuery({
    queryKey: qk.admin.users(query),
    queryFn: () => adminApi.users(query),
    placeholderData: keepPreviousData,
  });
}

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: qk.admin.user(id),
    queryFn: () => adminApi.user(id),
    enabled: Boolean(id),
  });
}

export function useCourseLearners(courseId: string, page = 1) {
  return useQuery({
    queryKey: qk.admin.courseLearners(courseId, page),
    queryFn: () => adminApi.courseLearners(courseId, page),
    enabled: Boolean(courseId),
    placeholderData: keepPreviousData,
  });
}

/**
 * Activate / deactivate. Deactivating also revokes the learner's refresh
 * tokens server-side, so the dashboards and their session both change — hence
 * invalidating the dashboard namespace as well as the user lists.
 */
export function useSetUserActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminApi.setActive(id, isActive),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: qk.admin.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
      toast.success(user.isActive ? 'Learner activated' : 'Learner deactivated');
    },
  });
}
