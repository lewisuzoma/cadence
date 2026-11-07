/**
 * Formatting helpers used by both sides.  The server needs them for seed and
 * log output; the client renders them in the UI.  Keeping one copy means a
 * duration never reads "1h 24m" in one place and "84 min" in another.
 */

/** `4h 20m`, `14m 20s`, `0m` — the catalog and course-detail duration style. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const rest = seconds % 60;
  if (minutes > 0) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** `08:42`, `1:02:03` — the player's timecode style (JetBrains Mono). */
export function formatTimecode(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(rest).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** `5 min 38 s left` — the dashboard's "Continue learning" copy. */
export function formatRemaining(positionSeconds: number, durationSeconds: number): string {
  const left = Math.max(0, Math.round(durationSeconds - positionSeconds));
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  if (minutes > 0 && seconds > 0) return `${minutes} min ${seconds} s left`;
  if (minutes > 0) return `${minutes} min left`;
  return `${seconds} s left`;
}

/** Lowercase kebab-case, used for course slugs on both sides. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function initials(user: { firstName: string; lastName: string }): string {
  return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
}

/**
 * A short, human relative time: "12 min ago", "2 h ago", "Yesterday".
 *
 * Shared because the activity feed, the notification dropdown, the
 * learners table and the dashboard all show the same kind of stamp, and
 * three slightly different renderings of "40 minutes ago" on one screen
 * looks like a bug even when each is individually correct.
 *
 * Past dates only, which is all this app has. Anything older than a week
 * falls back to an absolute date, because "23 days ago" is harder to act
 * on than "14 Oct".
 */
export function relativeTime(
  value: string | Date,
  now: Date = new Date(),
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return 'Just now';
  if (seconds < 90) return '1 min ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  // "Yesterday, 18:04" is how the artifact's activity feed reads.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  if (date >= startOfToday) {
    return `Today, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  if (date >= startOfYesterday) {
    return `Yesterday, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** "5 Nov 2026" — the artifact's date format for tables and detail pages. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "5 Nov 2026, 14:02" — used where the time matters, as on decisions. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(date)}, ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}

/** The viewer's timezone abbreviation, for charts that say which one they use. */
export function timezoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(
      new Date(),
    );
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? 'local time';
  } catch {
    return 'local time';
  }
}
