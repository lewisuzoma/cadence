import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * The Cadence mark: an Ink rounded square carrying a white pulse glyph, with
 * the wordmark beside it.
 *
 * Taken from the artifacts, where the mark is dark on every screen — the top
 * bar, the admin sidebar and the mobile app header — rather than cobalt.
 * Cobalt is reserved for actions, so using it for the logo would make the
 * brand compete with every primary button on the page.
 */
export function BrandMark({
  className,
  /**
   * On the cobalt sign-in panel the mark flips: a white tile with a cobalt
   * glyph. Everywhere else it is an Ink tile with a white glyph.
   */
  inverted = false,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-md',
        inverted ? 'bg-card text-primary' : 'bg-foreground text-background',
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
        <path
          d="M3 13.2c2.4 0 2.6-6.2 5-6.2s2.6 10 5 10 2.6-6.2 5-6.2h3"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Wordmark({
  to = '/dashboard',
  className,
  showAdminChip = false,
}: {
  to?: string;
  className?: string;
  showAdminChip?: boolean;
}) {
  return (
    <Link to={to} className={cn('flex items-center gap-2.5 rounded-md', className)}>
      <BrandMark />
      <span className="font-heading text-heading-sm tracking-tight">Cadence</span>
      {showAdminChip ? (
        <span className="rounded-pill bg-primary-tint px-2 py-0.5 text-overline uppercase text-primary-hover">
          Admin
        </span>
      ) : null}
    </Link>
  );
}
