import { useEffect, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationQuery } from '@cadence/shared';
import { qk } from '@/lib/query-keys';
import { notificationsApi } from './notifications.api';

/** The spec's polling interval for the bell. */
const POLL_INTERVAL_MS = 60_000;

/**
 * The notification bell's data.
 *
 * Polled every 60 seconds and refetched when the window regains focus,
 * which is what makes an approval show up without a reload. Polling is a
 * deliberate choice over websockets: one small request a minute is far
 * less machinery than a socket for a feature whose latency requirement is
 * "within a minute or so".
 */
export function useNotifications(filters: Partial<NotificationQuery> = {}) {
  return useQuery({
    queryKey: qk.notifications.list(filters),
    queryFn: () => notificationsApi.list(filters),
    refetchInterval: POLL_INTERVAL_MS,
    // Keep polling in a background tab so the badge is right on return.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    meta: { silent: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications.all });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markAllRead,
    meta: { silent: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications.all });
    },
  });
}

/**
 * Keeps `me` fresh when permissions may have changed underneath the user.
 *
 * The spec's requirement is that an approved applicant sees their new
 * navigation **without logging in again**. Three triggers cover it:
 *
 *  1. **Window focus** — the common case. They read the email or the
 *     notification on another tab and come back.
 *  2. **A new notification arrives.** The poll above is already running;
 *     when the unread count rises, the role may have changed with it, so
 *     `me` is refetched rather than waiting for a focus event that may
 *     never come if they are sitting on the page.
 *  3. **A 401 or 403 from an instructor endpoint**, handled in the API
 *     client, which means the server disagrees with what the UI believes.
 *
 * Mounted once in the app shell.
 */
export function useLivePermissions(unreadCount: number | undefined): void {
  const queryClient = useQueryClient();
  const previousUnread = useRef<number | undefined>(undefined);

  useEffect(() => {
    const previous = previousUnread.current;
    previousUnread.current = unreadCount;

    // Only a *rise* matters. Marking notifications read lowers the count
    // and says nothing about permissions.
    if (previous !== undefined && unreadCount !== undefined && unreadCount > previous) {
      void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
      void queryClient.invalidateQueries({ queryKey: qk.applications.mine() });
    }
  }, [unreadCount, queryClient]);

  useEffect(() => {
    const onFocus = () => {
      void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [queryClient]);
}
