import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { formatTimecode, type LessonSummary } from '@cadence/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The "Up next in this course" rail from artifact pages 6 and 9.
 *
 * Each row is a dark play thumbnail, an overline naming the row's role (NOW
 * PLAYING / UP NEXT / LESSON 10 / REVISIT), the title, the runtime and
 * status, and a progress sliver along the bottom — amber while in progress,
 * green once complete. The playing row is outlined in cobalt.
 */
function overlineFor(
  lesson: LessonSummary,
  index: number,
  currentIndex: number,
): string {
  if (index === currentIndex) return 'Now playing';
  if (index === currentIndex + 1) return 'Up next';
  if (lesson.status === 'COMPLETED') return 'Revisit';
  return `Lesson ${String(index + 1).padStart(2, '0')}`;
}

function statusLabel(lesson: LessonSummary): string {
  if (lesson.status === 'COMPLETED') return 'Completed';
  const percentage = lesson.progress?.completionPercentage ?? 0;
  if (percentage > 0) return `${percentage}% watched`;
  if (lesson.status === 'LOCKED') return 'Locked';
  return 'Not started';
}

export function UpNextList({
  lessons,
  courseSlug,
  currentLessonId,
  className,
}: {
  lessons: LessonSummary[];
  courseSlug: string;
  currentLessonId?: string;
  className?: string;
}) {
  const currentIndex = lessons.findIndex((lesson) => lesson.id === currentLessonId);

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {lessons.map((lesson, index) => {
        const isCurrent = lesson.id === currentLessonId;
        const locked = lesson.status === 'LOCKED';
        const percentage = lesson.progress?.completionPercentage ?? 0;
        const complete = lesson.status === 'COMPLETED';

        const body = (
          <>
            <span
              className={cn(
                'flex aspect-video w-16 shrink-0 items-center justify-center rounded-sm',
                isCurrent ? 'bg-primary' : 'bg-night',
              )}
              aria-hidden="true"
            >
              <Play className="size-4 fill-white text-white" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-overline uppercase text-muted-foreground">
                {overlineFor(lesson, index, currentIndex)}
              </span>
              <span
                className={cn(
                  'line-clamp-2 text-small font-semibold',
                  locked && 'text-muted-foreground',
                )}
              >
                {String(index + 1).padStart(2, '0')} · {lesson.title}
              </span>
              <span className="flex items-center gap-2 font-mono text-caption tabular text-muted-foreground">
                {formatTimecode(lesson.durationSeconds)}
                <span className={cn(complete && 'text-success', percentage > 0 && !complete && 'text-warning')}>
                  {statusLabel(lesson)}
                </span>
              </span>
            </span>
          </>
        );

        const shell = cn(
          'relative flex items-start gap-3 overflow-hidden rounded-md border p-3 transition-colors',
          isCurrent ? 'border-2 border-primary bg-primary-tint/40' : 'border-border bg-card hover:bg-muted/60',
        );

        return (
          <li key={lesson.id}>
            {locked ? (
              <div className={cn(shell, 'cursor-not-allowed opacity-70')} aria-disabled="true">
                {body}
                <span className="sr-only">Locked. Enroll in this course to watch.</span>
              </div>
            ) : (
              <Link
                to={`/courses/${courseSlug}/lessons/${lesson.id}`}
                className={shell}
                aria-current={isCurrent ? 'true' : undefined}
              >
                {body}
                {/* Progress sliver along the bottom edge of the row. */}
                {percentage > 0 ? (
                  <span
                    className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-pill bg-border"
                    aria-hidden="true"
                  >
                    <span
                      className={cn('block h-full', complete ? 'bg-success' : 'bg-night-accent')}
                      style={{ width: `${percentage}%` }}
                    />
                  </span>
                ) : null}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function UpNextListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-start gap-3 rounded-md border border-border p-3">
          <Skeleton className="aspect-video w-16 rounded-sm" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}
