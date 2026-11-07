import type { NotificationList, NotificationQuery } from '@cadence/shared';
import { apiClient, type Paginated } from '@/lib/api-client';

export const notificationsApi = {
  list: (query: Partial<NotificationQuery>): Promise<Paginated<NotificationList>> =>
    apiClient.getPaginated<NotificationList>('/notifications', { query }),

  markRead: (id: string) =>
    apiClient.post<{ unreadCount: number }>(`/notifications/${id}/read`),

  markAllRead: () =>
    apiClient.post<{ updated: number; unreadCount: number }>('/notifications/read-all'),
};
