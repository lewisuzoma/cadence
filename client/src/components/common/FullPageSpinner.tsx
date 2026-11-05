import { Loader2 } from 'lucide-react';

/**
 * The boot-time loading state, used while the session is being checked.
 *
 * It announces itself politely rather than assertively: this appears on first
 * paint, and an assertive live region would interrupt a screen reader before
 * the page has said anything at all.
 */
export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-7 animate-spin text-primary" aria-hidden="true" />
      <p className="text-small text-secondary-foreground">{label}</p>
    </div>
  );
}
