import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** One crumb. The last one is the current page and is never a link. */
export type Crumb = { label: string; to?: string };

/**
 * The page title block: optional breadcrumbs, an optional overline, a
 * display-size heading, a supporting line and actions on the right.
 * Matches the artifact's heading rhythm — Display 48 at desktop width,
 * stepping down on mobile.
 */
export function PageHeader({
  breadcrumbs,
  overline,
  title,
  description,
  actions,
  className,
}: {
  breadcrumbs?: Crumb[];
  overline?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-small">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                  {crumb.to && !last ? (
                    <Link
                      to={crumb.to}
                      className="font-semibold text-primary-hover underline-offset-2 hover:underline"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        last ? 'font-semibold text-foreground' : 'text-muted-foreground',
                      )}
                      // The last crumb is the page the user is on, which is
                      // what `aria-current="page"` is for.
                      {...(last ? { 'aria-current': 'page' as const } : {})}
                    >
                      {crumb.label}
                    </span>
                  )}
                  {last ? null : (
                    <span aria-hidden="true" className="text-muted-foreground">
                      /
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
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
      </div>
    </header>
  );
}
