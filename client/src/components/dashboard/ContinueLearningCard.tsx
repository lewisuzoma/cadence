import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { formatRemaining, formatTimecode, type ContinueLearning } from '@cadence/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The "Continue learning" banner.
 *
 * The artifact puts this at the top of both the catalog and the dashboard:
 * a 16:9 thumbnail on the left with a play affordance and an amber progress
 * sliver along its bottom edge, then an overline, a display-size sentence,
 * the lesson meta, and two actions.
 *
 * One component for both placements rather than two near-copies — the only
 * difference between them in the design is the surrounding page.
 */
export function ContinueLearningCard({
  item,
  className,
}: {
  item: ContinueLearning;
  className?: string;
}) {
  const lessonHref = `/courses/${item.courseSlug}/lessons/${item.lessonId}`;
  const watched =
    item.durationSeconds > 0
      ? Math.min(100, Math.round((item.lastPositionSeconds / item.durationSeconds) * 100))
      : 0;

  return (
    <Card variant="interactive" className={cn('overflow-hidden', className)}>
      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        <Link
          to={lessonHref}
          className="group/media relative block aspect-video overflow-hidden bg-night"
          tabIndex={-1}
          aria-hidden="true"
        >
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
          {/* The play affordance the artifact centres on the thumbnail. */}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-12 items-center justify-center rounded-pill bg-card shadow-overlay transition-transform group-hover/media:scale-105">
              <Play className="size-5 translate-x-0.5 fill-foreground text-foreground" />
            </span>
          </span>
          {/* Amber sliver: how far into this lesson the learner is. */}
          <span className="absolute inset-x-0 bottom-0 h-1.5 bg-night-track">
            <span className="block h-full bg-night-accent" style={{ width: `${watched}%` }} />
          </span>
        </Link>

        <div className="flex flex-col gap-3 p-6">
          <p className="text-overline uppercase text-muted-foreground">Continue learning</p>
          <h2 className="text-heading lg:text-display-sm">{item.lessonTitle}</h2>
          <p className="text-small text-secondary-foreground">
            {item.courseTitle} · {item.moduleTitle} ·{' '}
            {formatRemaining(item.lastPositionSeconds, item.durationSeconds)}
          </p>
          <div className="mt-1 flex flex-wrap gap-3">
            <Button asChild>
              <Link to={lessonHref}>
                <Play aria-hidden="true" />
                Resume at {formatTimecode(item.lastPositionSeconds)}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to={`/courses/${item.courseSlug}`}>Course overview</Link>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ContinueLearningSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        <Skeleton className="aspect-video rounded-none" />
        <div className="flex flex-col gap-3 p-6">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="mt-1 flex gap-3">
            <Skeleton className="h-11 w-40 rounded-md" />
            <Skeleton className="h-11 w-36 rounded-md" />
          </div>
        </div>
      </div>
    </Card>
  );
}
