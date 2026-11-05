import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

/**
 * Slider — the player's seek bar and volume control.
 *
 * `buffered` draws a second, dimmer track behind the played range, which is
 * what the design's scrubber shows (played, buffered, remaining).
 */
export type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  /** 0–100, the fraction of the media already downloaded. */
  buffered?: number;
  tone?: 'primary' | 'night';
};

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, buffered, tone = 'primary', ...props }, ref) => (
    <SliderPrimitive.Root
      ref={ref}
      className={cn('relative flex w-full touch-none select-none items-center py-2', className)}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative h-1.5 w-full grow overflow-hidden rounded-pill',
          tone === 'night' ? 'bg-white/25' : 'bg-muted',
        )}
      >
        {buffered !== undefined ? (
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-pill',
              tone === 'night' ? 'bg-white/30' : 'bg-border',
            )}
            style={{ width: `${Math.min(100, Math.max(0, buffered))}%` }}
            aria-hidden="true"
          />
        ) : null}
        <SliderPrimitive.Range
          className={cn('absolute h-full rounded-pill', tone === 'night' ? 'bg-white' : 'bg-primary')}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block size-4 rounded-pill border-2 shadow-card transition-transform hover:scale-110',
          tone === 'night' ? 'border-white bg-white' : 'border-primary bg-card',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
      />
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = 'Slider';

export { Slider };
