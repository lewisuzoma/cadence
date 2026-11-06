import { Link } from 'react-router-dom';
import { CheckCircle2, Clock } from 'lucide-react';
import { formatDuration, type CourseSummary } from '@cadence/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, pluralize } from '@/lib/utils';

/**
 * The catalog card.
 *
 * Laid out to match the artifact exactly:
 *
 *   ┌──────────────────────────┐
 *   │ [Category]      ╮ media  │  category chip overlaid top-left,
 *   │            [⏱ 4h 20m]    │  duration pill bottom-right
 *   ├──────────────────────────┤
 *   │ Title                    │
 *   │ Description, two lines   │
 *   │ 12 lessons · Intermediate   [58% · In progress] │
 *   │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░  │  track always present
 *   │ [        Resume        ] │  one full-width action
 *   └──────────────────────────┘
 *
 * Presentational only: it fetches nothing and decides nothing. The CTA is
 * chosen from the enrollment state the server sent, so the same card works in
 * the catalog, the dashboard and "My learning".
 */
export type CourseCardProps = {
  course: CourseSummary;
  /** Prefetch on hover/focus so opening the course feels instant. */
  onPrefetch?: (slug: string) => void;
  className?: string;
};

export function CourseCard({ course, onPrefetch, className }: CourseCardProps) {
  const enrollment = course.enrollment;
  const to = `/courses/${course.slug}`;
  const completed = enrollment?.status === 'COMPLETED';
  const progress = enrollment?.progressPercentage ?? 0;

  // The artifact's three CTAs.
  const cta = enrollment?.isEnrolled
    ? completed
      ? { label: 'Review course', variant: 'secondary' as const }
      : { label: 'Resume', variant: 'secondary' as const }
    : { label: 'Enroll — free', variant: 'default' as const };

  const prefetch = () => onPrefetch?.(course.slug);

  return (
    <Card
      variant="interactive"
      className={cn('flex h-full flex-col overflow-hidden', className)}
      onMouseEnter={prefetch}
      onFocus={prefetch}
    >
      {/* Media */}
      <div className="relative aspect-video overflow-hidden bg-muted">
        <img
          src={course.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
        <span className="absolute left-3 top-3 rounded-pill bg-card px-2.5 py-1 text-caption font-semibold text-foreground shadow-card">
          {course.category}
        </span>
        <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-pill bg-night/85 px-2.5 py-1 font-mono text-caption text-night-foreground tabular">
          <Clock className="size-3.5" aria-hidden="true" />
          {formatDuration(course.estimatedDuration)}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="text-title">
          <Link
            to={to}
            className="transition-colors hover:text-primary-hover"
            onMouseEnter={prefetch}
            onFocus={prefetch}
          >
            {course.title}
          </Link>
        </h3>

        <p className="line-clamp-2 text-small text-secondary-foreground">{course.description}</p>

        {/* Meta on the left, status on the right — one row, as in the design. */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-caption text-muted-foreground">
            {pluralize(course.lessonCount, 'lesson')} ·{' '}
            {course.difficulty.charAt(0) + course.difficulty.slice(1).toLowerCase()}
          </p>
          <CourseProgressBadge course={course} />
        </div>

        {/*
          The track is always rendered, even at 0%, so cards in a grid line up
          and nothing shifts when a learner enrols. `aria-hidden` because the
          badge beside it already states the percentage in words.
        */}
        <div
          className="h-1.5 w-full overflow-hidden rounded-pill bg-border"
          aria-hidden="true"
        >
          <div
            className={cn(
              'h-full rounded-pill transition-[width] duration-500',
              completed ? 'bg-success' : 'bg-primary',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <Button asChild variant={cta.variant} className="w-full">
          <Link to={to}>{cta.label}</Link>
        </Button>
      </div>
    </Card>
  );
}

/**
 * The status pill the artifact puts beside the lesson count: a percentage for
 * an in-progress course, a tick for a finished one, plain grey otherwise.
 */
function CourseProgressBadge({ course }: { course: CourseSummary }) {
  const enrollment = course.enrollment;

  if (!enrollment?.isEnrolled) {
    return <Badge variant="secondary">Not started</Badge>;
  }
  if (enrollment.status === 'COMPLETED') {
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden="true" />
        Completed
      </Badge>
    );
  }
  return <Badge variant="warning">{enrollment.progressPercentage}% · In progress</Badge>;
}

/**
 * The loading placeholder. Its geometry mirrors CourseCard exactly — same
 * aspect ratio, same padding, same rows — so the grid does not reflow when
 * real data arrives ("Skeletons match the final card geometry so nothing
 * jumps", artifact page 10).
 */
export function CourseCardSkeleton() {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <Skeleton className="aspect-video rounded-none" />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/5" />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-24 rounded-pill" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-pill" />
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
    </Card>
  );
}

export function CourseCardSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <CourseCardSkeleton key={index} />
      ))}
    </>
  );
}
