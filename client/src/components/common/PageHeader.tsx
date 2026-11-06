import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The page title block: an optional overline, a display-size heading, a
 * supporting line and actions on the right. Matches the artifact's heading
 * rhythm — Display 48 at desktop width, stepping down on mobile.
 */
export function PageHeader({
  overline,
  title,
  description,
  actions,
  className,
}: {
  overline?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}
    >
      <div className="flex flex-col gap-2">
        {overline ? (
          <p className="text-overline uppercase text-muted-foreground">{overline}</p>
        ) : null}
        <h1 className="text-display-sm lg:text-display">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-body text-secondary-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>
      ) : null}
    </header>
  );
}
