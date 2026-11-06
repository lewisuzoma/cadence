import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Lock, PlayCircle } from 'lucide-react';
import { formatTimecode, type LessonSummary, type ModuleWithLessons } from '@cadence/shared';
import { PreviewBadge } from '@/components/common/StatusBadge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The curriculum list.
 *
 * Shows order number, title, duration, status icon and a mini progress bar,
 * highlights the lesson being watched with `aria-current`, and renders a lock
 * for lessons this learner cannot open yet. A locked row is not a link, so
 * keyboard users do not tab onto something that would only 403.
 */

function statusIcon(status: LessonSummary['status']) {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />;
    case 'IN_PROGRESS':
      return <PlayCircle className="size-5 shrink-0 text-warning" aria-hidden="true" />;
    case 'LOCKED':
      return <Lock className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />;
    default:
      return <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
}

export type LessonRowProps = {
  lesson: LessonSummary;
  index: number;
  courseSlug: string;
  isCurrent?: boolean;
  /** False for a visitor with no enrollment, which locks non-preview rows. */
  canOpen?: boolean;
};

export function LessonRow({
  lesson,
  index,
  courseSlug,
  isCurrent = false,
  canOpen = true,
}: LessonRowProps) {
  const locked = lesson.status === 'LOCKED' || (!canOpen && !lesson.isPreview);
  const percentage = lesson.progress?.completionPercentage ?? 0;

  const body = (
    <>
      <span className="flex w-7 shrink-0 justify-center font-mono text-caption tabular text-muted-foreground">
        {String(index + 1).padStart(2, '0')}
      </span>
      {statusIcon(lesson.status)}

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn('truncate text-small font-semibold', locked && 'text-muted-foreground')}>
            {lesson.title}
          </span>
          {lesson.isPreview && !canOpen ? <PreviewBadge /> : null}
        </span>

        <span className="flex items-center gap-2 font-mono text-caption tabular text-muted-foreground">
          {formatTimecode(lesson.durationSeconds)}
          {lesson.progress && !lesson.progress.isCompleted && percentage > 0 ? (
            <span className="text-warning">{percentage}% watched</span>
          ) : null}
        </span>

        {/* A sliver of progress, only where there is some. */}
        {percentage > 0 && !lesson.progress?.isCompleted ? (
          <Progress
            value={percentage}
            label={`${lesson.title} progress`}
            tone="warning"
            size="sm"
            className="mt-0.5 max-w-40"
          />
        ) : null}
      </span>
    </>
  );

  const shared = cn(
    'flex items-start gap-3 rounded-md px-3 py-3 transition-colors',
    isCurrent
      ? 'border-2 border-primary bg-primary-tint'
      : 'border-2 border-transparent hover:bg-muted',
  );

  if (locked) {
    return (
      <li>
        <div className={cn(shared, 'cursor-not-allowed opacity-70')} aria-disabled="true">
          {body}
          <span className="sr-only">Locked. Enroll in this course to watch.</span>
        </div>
      </li>
    );
  }

  return (
    <li>
      <Link
        to={`/courses/${courseSlug}/lessons/${lesson.id}`}
        className={cn(shared, 'min-h-11')}
        aria-current={isCurrent ? 'true' : undefined}
      >
        {body}
        {isCurrent ? <span className="sr-only">Now playing</span> : null}
      </Link>
    </li>
  );
}

/** Module-grouped list, used on the course detail page. */
export function LessonList({
  modules,
  courseSlug,
  currentLessonId,
  canOpen = true,
  className,
}: {
  modules: ModuleWithLessons[];
  courseSlug: string;
  currentLessonId?: string;
  canOpen?: boolean;
  className?: string;
}) {
  // Lesson numbering runs across the whole course, as the design shows
  // ("05 · Validating input with Zod" in module 2).
  let runningIndex = -1;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {modules.map((module) => {
        const completed = module.lessons.filter((lesson) => lesson.status === 'COMPLETED').length;
        const moduleSeconds = module.lessons.reduce(
          (total, lesson) => total + lesson.durationSeconds,
          0,
        );

        return (
          <section key={module.id} className="flex flex-col gap-2">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-title">{module.title}</h3>
              <p className="font-mono text-caption tabular text-muted-foreground">
                {module.lessons.length} lessons · {formatTimecode(moduleSeconds)} · {completed}/
                {module.lessons.length}
              </p>
            </header>
            <ul className="flex flex-col gap-1">
              {module.lessons.map((lesson) => {
                runningIndex += 1;
                return (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    index={runningIndex}
                    courseSlug={courseSlug}
                    canOpen={canOpen}
                    isCurrent={lesson.id === currentLessonId}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The flat "Up next in this course" list beside the player. */
export function LessonSidebarList({
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
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {lessons.map((lesson, index) => (
        <LessonRow
          key={lesson.id}
          lesson={lesson}
          index={index}
          courseSlug={courseSlug}
          isCurrent={lesson.id === currentLessonId}
        />
      ))}
    </ul>
  );
}

export function LessonListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="flex flex-col gap-1">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-start gap-3 px-3 py-3">
          <Skeleton className="size-5 rounded-pill" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}
