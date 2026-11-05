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
