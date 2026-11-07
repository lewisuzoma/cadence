import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Learning ⇄ Teaching.
 *
 * From desktop artifact pages 4–13, where it sits immediately right of the
 * wordmark as a segmented control: a muted track with the active half
 * raised on white.
 *
 * It is a navigation control, not a mode flag. Nothing is stored and
 * nothing is remembered — which half is active is derived from the URL, so
 * a deep link into the teaching area shows "Teaching" selected and the
 * back button behaves exactly as it should. A remembered "current
 * workspace" would be a second source of truth for something the address
 * bar already says.
 */
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const teaching = location.pathname.startsWith('/instructor');

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-pill bg-muted p-1',
        className,
      )}
      role="group"
      aria-label="Workspace"
    >
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        aria-current={!teaching ? 'page' : undefined}
        className={cn(
          'flex min-h-9 items-center gap-2 rounded-pill px-3 text-small font-semibold transition-colors',
          teaching
            ? 'text-secondary-foreground hover:text-foreground'
            : 'bg-card text-foreground shadow-sm',
        )}
      >
        <BookOpen className="size-4" aria-hidden="true" />
        Learning
      </button>
      <button
        type="button"
        onClick={() => navigate('/instructor')}
        aria-current={teaching ? 'page' : undefined}
        className={cn(
          'flex min-h-9 items-center gap-2 rounded-pill px-3 text-small font-semibold transition-colors',
          teaching
            ? 'bg-card text-foreground shadow-sm'
            : 'text-secondary-foreground hover:text-foreground',
        )}
      >
        <GraduationCap className="size-4" aria-hidden="true" />
        Teaching
      </button>
    </div>
  );
}
