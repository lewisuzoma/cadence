import { Link } from 'react-router-dom';
import type { ActivityItem } from '@cadence/shared';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

/**
 * One line of the activity feed, shared by the learner dashboard and the
 * admin feed. `showUser` is what differs: a learner sees their own history, so
 * repeating their name on every row would be noise; an admin needs to know
 * who did what.
 *
 * In its own file rather than exported from a page, so the page stays a module
 * that exports only its component (which is what keeps fast refresh working).
 */
const ACTIVITY_COPY: Record<ActivityItem['type'], string> = {
  ENROLLED: 'Enrolled in',
  LESSON_STARTED: 'Started',
  LESSON_COMPLETED: 'Completed',
  COURSE_COMPLETED: 'Finished the course',
};

export function ActivityRow({
  item,
  showUser = false,
}: {
  item: ActivityItem;
  showUser?: boolean;
}) {
  const variant =
    item.type === 'LESSON_COMPLETED' || item.type === 'COURSE_COMPLETED'
      ? 'success'
      : 'secondary';

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <Badge variant={variant}>{ACTIVITY_COPY[item.type]}</Badge>
      <p className="min-w-0 flex-1 text-small">
        {showUser && item.user ? (
          <span className="font-semibold">
            {item.user.firstName} {item.user.lastName}{' '}
          </span>
        ) : null}
        <Link
          to={
            item.lessonId
              ? `/courses/${item.courseSlug}/lessons/${item.lessonId}`
              : `/courses/${item.courseSlug}`
          }
          className="hover:text-primary-hover"
        >
          {item.lessonTitle ?? item.courseTitle}
        </Link>
        {item.lessonTitle ? (
          <span className="text-muted-foreground"> in {item.courseTitle}</span>
        ) : null}
      </p>
      <time className="shrink-0 text-caption text-muted-foreground" dateTime={item.occurredAt}>
        {relativeTime(item.occurredAt)}
      </time>
    </div>
  );
}
