import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge.
 *
 * The design's third principle is "Status = icon + word + colour. Never
 * colour alone", so every status badge in this app renders a Lucide icon
 * beside its label — see components/common/StatusBadge.tsx, which is the only
 * thing that should be used for status. This primitive supplies the colours.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-caption font-semibold transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-muted text-secondary-foreground',
        outline: 'border-border bg-transparent text-secondary-foreground',
        /** Completed — Green #0E8A5C */
        success: 'border-transparent bg-success-tint text-success',
        /** In progress — Amber #B85C00, darkened on tint for AA contrast */
        warning: 'border-transparent bg-warning-tint text-warning',
        /** Errors, delete — Red #C2261B */
        destructive: 'border-transparent bg-destructive-tint text-destructive',
        /** Selected / published — Cobalt tint #EAEEFF */
        info: 'border-transparent bg-primary-tint text-primary-hover',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
