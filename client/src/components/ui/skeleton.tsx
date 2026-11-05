import { cn } from '@/lib/utils';

/**
 * Skeleton.  The artifact is explicit: "Skeletons match the final card
 * geometry so nothing jumps. Shimmer is disabled under reduced motion." The
 * shimmer and the reduced-motion opt-out live in the `.skeleton` class in
 * globals.css; sizing is the caller's job, and each skeleton component in
 * components/common mirrors its real counterpart's dimensions.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton', className)} aria-hidden="true" {...props} />;
}
