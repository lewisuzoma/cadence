import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * A single headline number with its label and a supporting line.
 *
 * `value` is always passed in from an API aggregate — there is no default and
 * no placeholder, so a stat cannot silently render a made-up figure.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  /**
   * Tints the icon chip, as the instructor dashboard's cards do.
   *
   * Decoration only: the figure and its label carry the meaning, so a
   * reader who cannot see the colour loses nothing.
   */
  tone?: 'success' | 'warning' | 'info';
  className?: string;
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-success-tint text-success'
      : tone === 'warning'
        ? 'bg-warning-tint text-warning'
        : tone === 'info'
          ? 'bg-primary-tint text-primary-hover'
          : 'bg-muted text-muted-foreground';

  return (
    <Card className={cn('flex flex-col gap-2 p-5', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-small font-semibold text-secondary-foreground">{label}</p>
        {Icon ? (
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md',
              toneClass,
            )}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <p className="text-display-sm tabular">{value}</p>
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-20" />
      <Skeleton className="h-3 w-36" />
    </Card>
  );
}

export function StatCardSkeletonRow({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <StatCardSkeleton key={index} />
      ))}
    </>
  );
}
