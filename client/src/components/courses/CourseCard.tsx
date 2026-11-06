import { Link } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';
import { formatDuration, type CourseSummary } from '@cadence/shared';
import {
  DifficultyBadge,
  EnrollmentStatusBadge,
} from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, pluralize } from '@/lib/utils';

/**
 * The catalog card.
 *
 * Presentational only: it fetches nothing and decides nothing. The CTA is
 * chosen from the enrollment state the server sent, and the click handler is
 * the caller's, so the same card works in the catalog, the dashboard and
 * "My learning".
 *
 * Every field the design shows is here: category and difficulty chips,
 * 16:9 thumbnail, title, a two-line description clamp, duration and lesson
 * count, the status badge, a progress bar with its percentage, and one
 * primary action.
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

  // The design's three CTAs: Resume, Review course, Enroll.
  const cta = enrollment?.isEnrolled
    ? enrollment.status === 'COMPLETED'
      ? { label: 'Review course', variant: 'secondary' as const }
      : { label: 'Resume', variant: 'default' as const }
    : { label: 'Enroll — free', variant: 'default' as const };

  const prefetch = () => onPrefetch?.(course.slug);

  return (
    <Card
      variant="interactive"
      className={cn('flex h-full flex-col overflow-hidden', className)}
      onMouseEnter={prefetch}
      onFocus={prefetch}
    >
      <Link
        to={to}
        // The whole card is one link; the CTA below repeats it for clarity but
        // is not a second tab stop for the same destination.
        className="group/media relative block aspect-video overflow-hidden bg-muted"
        tabIndex={-1}
        aria-hidden="true"
      >
        <img
          src={course.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-300 group-hover/media:scale-[1.03]"
        />
        <span className="absolute right-3 top-3 rounded-pill bg-night/80 px-2.5 py-1 font-mono text-caption text-night-foreground tabular">
          {formatDuration(course.estimatedDuration)}
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{course.category}</Badge>
          <DifficultyBadge difficulty={course.difficulty} />
        </div>

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

        {/* Clamped to two lines, as the design shows. */}
        <p className="line-clamp-2 text-small text-secondary-foreground">{course.description}</p>

        <p className="text-caption text-muted-foreground">
          {pluralize(course.lessonCount, 'lesson')}
          {' · '}
          {course.difficulty.charAt(0) + course.difficulty.slice(1).toLowerCase()}
        </p>

        {/* Progress only once there is progress to show. */}
        {enrollment?.isEnrolled ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <EnrollmentStatusBadge status={enrollment.status} />
              <span className="font-mono text-caption tabular text-secondary-foreground">
                {enrollment.progressPercentage}%
              </span>
            </div>
            <Progress
              value={enrollment.progressPercentage}
              label={`${course.title} progress`}
              tone={enrollment.status === 'COMPLETED' ? 'success' : 'primary'}
              size="sm"
            />
          </div>
        ) : (
          <EnrollmentStatusBadge status={null} />
        )}

        <div className="mt-auto pt-2">
          <Button asChild variant={cta.variant} className="w-full">
            <Link to={to}>
              {enrollment?.isEnrolled && enrollment.status !== 'COMPLETED' ? (
                <PlayCircle aria-hidden="true" />
              ) : null}
              {cta.label}
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * The loading placeholder. Its geometry mirrors CourseCard exactly — same
 * aspect ratio, same padding, same number of text rows — so the grid does not
 * reflow when real data arrives ("Skeletons match the final card geometry so
 * nothing jumps").
 */
export function CourseCardSkeleton() {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <Skeleton className="aspect-video rounded-none" />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-pill" />
          <Skeleton className="h-5 w-24 rounded-pill" />
        </div>
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-5 w-28 rounded-pill" />
        <div className="mt-auto pt-2">
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
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
