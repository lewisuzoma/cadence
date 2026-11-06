import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ActivityItem, AdminDashboard, LearnerDashboard } from '@cadence/shared';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

export const dashboardApi = {
  learner: () => apiClient.get<LearnerDashboard>('/dashboard/learner'),
  admin: () => apiClient.get<AdminDashboard>('/dashboard/admin'),
  myActivity: (page: number) =>
    apiClient.getPaginated<ActivityItem[]>('/activity/me', { query: { page } }),
  platformActivity: (page: number) =>
    apiClient.getPaginated<ActivityItem[]>('/admin/activity', { query: { page } }),
};

/**
 * Dashboards are aggregates, so they go stale as soon as anything is written.
 * The mutations that affect them invalidate `qk.dashboard.all`; the shorter
 * staleTime here covers changes made by someone else in the meantime.
 */
export function useLearnerDashboard() {
  return useQuery({
    queryKey: qk.dashboard.learner(),
    queryFn: dashboardApi.learner,
    staleTime: 15_000,
  });
}

export function useAdminDashboard() {
  return useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: dashboardApi.admin,
    staleTime: 15_000,
  });
}

export function useMyActivity(page = 1) {
  return useQuery({
    queryKey: qk.activity.mine(page),
    queryFn: () => dashboardApi.myActivity(page),
    placeholderData: keepPreviousData,
  });
}

export function usePlatformActivity(page = 1) {
  return useQuery({
    queryKey: qk.activity.platform(page),
    queryFn: () => dashboardApi.platformActivity(page),
    placeholderData: keepPreviousData,
  });
}
