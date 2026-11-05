import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, BookOpen, Inbox, RefreshCw, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Empty, error, forbidden and not-found states.
 *
 * Page 10 of the desktop artifact specifies these, including the copy. Every
 * list and detail view uses one of them rather than rendering nothing, so a
 * screen is never ambiguous about whether it is loading, empty or broken.
 */

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: { label: string; to?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col items-center gap-4 px-6 py-14 text-center', className)}>
      <span className="flex size-14 items-center justify-center rounded-pill bg-primary-tint text-primary">
        <Icon className="size-7" aria-hidden="true" />
      </span>
      <div className="flex max-w-sm flex-col gap-2">
        <h2 className="font-heading text-heading-sm">{title}</h2>
        <p className="text-small text-secondary-foreground">{description}</p>
      </div>
      {action ? (
        action.to ? (
          <Button asChild>
            <Link to={action.to}>{action.label}</Link>
          </Button>
        ) : (
          <Button onClick={action.onClick}>{action.label}</Button>
        )
      ) : null}
    </Card>
  );
}

/**
 * The error state from the artifact, with its copy: the server did not
 * respond, progress is safe, try again. `onRetry` is wired to the query's
 * `refetch`, and `reference` shows the short code the artifact displays.
 */
export function ErrorState({
  title = 'Could not load this',
  description = 'The server did not respond. Your progress is safe, so try again in a moment.',
  onRetry,
  reference,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  reference?: string;
  className?: string;
}) {
  return (
    <Card
      role="alert"
      className={cn('flex flex-col items-center gap-4 px-6 py-14 text-center', className)}
    >
      <span className="flex size-14 items-center justify-center rounded-pill bg-destructive-tint text-destructive">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
      <div className="flex max-w-sm flex-col gap-2">
        <h2 className="font-heading text-heading-sm">{title}</h2>
        <p className="text-small text-secondary-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
        ) : null}
        {reference ? (
          <span className="font-mono text-caption text-muted-foreground">Ref {reference}</span>
        ) : null}
      </div>
    </Card>
  );
}

/** The 403 state: signed in as a learner, ask an administrator for access. */
export function ForbiddenState({ className }: { className?: string }) {
  return (
    <Card className={cn('flex flex-col items-center gap-4 px-6 py-14 text-center', className)}>
      <span className="flex size-14 items-center justify-center rounded-pill bg-warning-tint text-warning">
        <ShieldAlert className="size-7" aria-hidden="true" />
      </span>
      <div className="flex max-w-sm flex-col gap-2">
        <h2 className="font-heading text-heading-sm">Admins only</h2>
        <p className="text-small text-secondary-foreground">
          You are signed in as a learner. Ask an administrator if you need access.
        </p>
      </div>
      <Button asChild variant="secondary">
        <Link to="/my-learning">Back to my learning</Link>
      </Button>
    </Card>
  );
}

export function NotFoundState({ className }: { className?: string }) {
  return (
    <Card className={cn('flex flex-col items-center gap-4 px-6 py-14 text-center', className)}>
      <span className="flex size-14 items-center justify-center rounded-pill bg-muted text-muted-foreground">
        <BookOpen className="size-7" aria-hidden="true" />
      </span>
      <div className="flex max-w-sm flex-col gap-2">
        <h2 className="font-heading text-heading-sm">We could not find that page</h2>
        <p className="text-small text-secondary-foreground">
          The link may be out of date, or the course may have been archived.
        </p>
      </div>
      <Button asChild>
        <Link to="/courses">Browse courses</Link>
      </Button>
    </Card>
  );
}
