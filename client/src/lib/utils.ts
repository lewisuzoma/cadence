import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge has to be told about this project's type scale.
 *
 * Out of the box it recognises Tailwind's stock font sizes (`text-sm`,
 * `text-lg`, …) and classifies every *other* `text-*` as a colour. Our scale
 * is named after the artifact (`text-small`, `text-caption`, `text-body`, …),
 * so it fell into the colour group — which put font sizes and real colours in
 * one bucket where only the last class survives.
 *
 * That silently broke every Button: `buttonVariants` emits a size from the
 * base (`text-small`), a colour from the variant (`text-background`) and
 * another size from the size (`text-caption`), and the merge kept exactly one
 * of the three. The visible symptom was the catalog's selected category chip
 * rendering as Ink-on-Ink — it lost `text-background` and inherited the body
 * colour — but `destructive`/`success` buttons at `sm`/`lg` were losing their
 * foreground colour the same way, and `default`-size buttons were losing
 * their font size and rendering at the inherited 16px.
 *
 * Listing the scale here is what keeps sizes and colours in separate groups,
 * so one of each survives. Any new entry in `tailwind.config.ts`'s `fontSize`
 * or `boxShadow` must be added here too.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display',
            'display-sm',
            'heading',
            'heading-sm',
            'title',
            'body',
            'small',
            'caption',
            'overline',
            'timecode',
          ],
        },
      ],
      // Same trap, smaller blast radius: custom shadow names would otherwise
      // be read as shadow *colours* rather than as shadows.
      shadow: [{ shadow: ['hover', 'card', 'overlay'] }],
      /*
       * `rounded-pill` is ours too, so `rounded-md rounded-pill` was leaving
       * both classes in place and letting CSS source order pick the winner.
       * It happened to pick the pill, but nothing was enforcing that.
       */
      rounded: [{ rounded: ['pill'] }],
    },
  },
});

/** The shadcn class helper: conditional classes, with Tailwind conflicts resolved. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "2 hours ago", "Yesterday", "3 days ago" — the activity feed's style. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'Just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;

  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "12 Oct 2026" — the course-detail "Since" line. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Sentence-cases an enum for display: ADVANCED → Advanced. */
export function humanize(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
