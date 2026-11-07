import { Link } from 'react-router-dom';
import {
  Archive,
  Bell,
  CheckCircle2,
  GraduationCap,
  PauseCircle,
  Pencil,
  Plus,
  XCircle,
} from 'lucide-react';
import type { Notification, NotificationType } from '@cadence/shared';
import { relativeTime } from '@cadence/shared';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/features/notifications/notifications.queries';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useState } from 'react';

/**
 * The bell and its dropdown, from desktop artifact page 17.
 *
 * Each notification type gets its own icon and tint rather than a generic
 * dot, because the list is scanned rather than read: an approval and an
 * archived course should be distinguishable without parsing the sentence.
 */
const ICONS: Record<
  NotificationType,
  { icon: typeof Bell; className: string }
> = {
  APPLICATION_SUBMITTED: { icon: Plus, className: 'bg-primary-tint text-primary-hover' },
  APPLICATION_RECEIVED: { icon: GraduationCap, className: 'bg-primary-tint text-primary-hover' },
  APPLICATION_APPROVED: { icon: GraduationCap, className: 'bg-primary-tint text-primary-hover' },
  APPLICATION_REJECTED: { icon: XCircle, className: 'bg-destructive-tint text-destructive' },
  APPLICATION_WITHDRAWN: { icon: Pencil, className: 'bg-muted text-muted-foreground' },
  INSTRUCTOR_SUSPENDED: { icon: PauseCircle, className: 'bg-destructive-tint text-destructive' },
  INSTRUCTOR_REINSTATED: { icon: CheckCircle2, className: 'bg-success-tint text-success' },
  COURSE_PUBLISHED: { icon: CheckCircle2, className: 'bg-success-tint text-success' },
  COURSE_UNPUBLISHED: { icon: Pencil, className: 'bg-muted text-muted-foreground' },
  COURSE_ARCHIVED: { icon: Archive, className: 'bg-muted text-muted-foreground' },
  COURSE_LESSONS_ADDED: { icon: Plus, className: 'bg-warning-tint text-warning' },
};

function NotificationRow({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: (id: string) => void;
}) {
  const { icon: Icon, className } = ICONS[notification.type];
  const unread = notification.readAt === null;

  const body = (
    <>
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
          className,
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-small font-semibold text-foreground">
          {notification.title}
        </span>
        <span className="block text-small text-secondary-foreground">
          {notification.body}
        </span>
        <span className="mt-1 block font-mono text-caption text-muted-foreground">
          {relativeTime(notification.createdAt)}
        </span>
      </span>
      {unread ? (
        <span
          className="mt-2 size-2 shrink-0 rounded-full bg-primary"
          aria-label="Unread"
        />
      ) : null}
    </>
  );

  const rowClass = cn(
    'flex w-full gap-3 rounded-lg px-3 py-3 text-left transition-colors',
    unread ? 'bg-primary-tint/50' : 'hover:bg-muted',
  );

  // Only notifications with somewhere to go become links; the rest are
  // still clickable to mark them read.
  return notification.link ? (
    <Link to={notification.link} className={rowClass} onClick={() => onRead(notification.id)}>
      {body}
    </Link>
  ) : (
    <button type="button" className={rowClass} onClick={() => onRead(notification.id)}>
      {body}
    </button>
  );
}

export function NotificationBell() {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const { data, isPending } = useNotifications(
    tab === 'unread' ? { unreadOnly: true, pageSize: 10 } : { pageSize: 10 },
  );
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = data?.items.unreadCount ?? 0;
  const items = data?.items.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-border bg-card transition-colors hover:bg-muted"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
        >
          <Bell className="size-5" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span
              className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-caption font-semibold text-destructive-foreground"
              aria-hidden="true"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <span className="text-small font-semibold text-foreground">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all as read
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as 'all' | 'unread')}>
          <TabsList className="mx-3 mt-2">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread{unreadCount > 0 ? ` · ${unreadCount}` : ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <ScrollArea className="max-h-96">
          <div className="flex flex-col gap-1 p-2">
            {isPending ? (
              <p className="px-3 py-6 text-center text-small text-muted-foreground">
                Loading notifications…
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-small text-muted-foreground">
                {tab === 'unread' ? 'Nothing unread.' : 'No notifications yet.'}
              </p>
            ) : (
              items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onRead={(id) => {
                    if (notification.readAt === null) markRead.mutate(id);
                  }}
                />
              ))
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-caption text-muted-foreground">
          <span>Checks for new items every 60 s</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
