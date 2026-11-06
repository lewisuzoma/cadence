import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Pagination.
 *
 * A `<nav>` with an accessible name, `aria-current` on the active page, and a
 * live region announcing the position — so a screen-reader user knows where
 * they are without counting buttons. Page windows around the current page so
 * 40 pages do not produce 40 buttons.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const windowSize = 2;
  const pages: (number | 'gap')[] = [];
  for (let candidate = 1; candidate <= totalPages; candidate++) {
    const isEdge = candidate === 1 || candidate === totalPages;
    const isNear = Math.abs(candidate - page) <= windowSize;
    if (isEdge || isNear) {
      pages.push(candidate);
    } else if (pages[pages.length - 1] !== 'gap') {
      pages.push('gap');
    }
  }

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex flex-wrap items-center justify-center gap-2', className)}
    >
      <Button
        variant="secondary"
        size="icon"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft />
      </Button>

      <ul className="flex items-center gap-1">
        {pages.map((entry, index) =>
          entry === 'gap' ? (
            <li
              key={`gap-${index}`}
              className="px-2 text-muted-foreground"
              aria-hidden="true"
            >
              &hellip;
            </li>
          ) : (
            <li key={entry}>
              <Button
                variant={entry === page ? 'default' : 'ghost'}
                size="icon"
                onClick={() => onPageChange(entry)}
                aria-label={`Page ${entry}`}
                aria-current={entry === page ? 'page' : undefined}
                className="tabular"
              >
                {entry}
              </Button>
            </li>
          ),
        )}
      </ul>

      <Button
        variant="secondary"
        size="icon"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <ChevronRight />
      </Button>

      <p aria-live="polite" className="sr-only">
        Page {page} of {totalPages}
      </p>
    </nav>
  );
}
