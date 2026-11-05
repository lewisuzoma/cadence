import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

/**
 * Progress bar.  The accessible name has to say what is progressing, so
 * `label` is required rather than optional: a bare "58%" read out of context
 * tells a screen-reader user nothing.
 */
export type ProgressProps = React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
  value?: number | null;
  label: string;
  tone?: 'primary' | 'success' | 'warning';
  size?: 'sm' | 'default';
};

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, label, tone = 'primary', size = 'default', ...props }, ref) => {
  const clamped = Math.min(100, Math.max(0, Math.round(value ?? 0)));
  const toneClass =
    tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-primary';

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        'relative w-full overflow-hidden rounded-pill bg-muted',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className,
      )}
      value={clamped}
      aria-label={label}
      aria-valuetext={`${clamped}%`}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full w-full flex-1 transition-transform duration-500', toneClass)}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = 'Progress';

export { Progress };
